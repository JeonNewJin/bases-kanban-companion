'use strict';

const { getDestination } = require('./core.cjs');
const { managedSortProperty } = require('./value-sort.cjs');
const SUPPORTED_VERSION = '1.14.4';
const MAX_COLUMN_SIZE = 200;
const own = (fm, key) => Object.prototype.hasOwnProperty.call(fm, key);
const value = (fm, key) => own(fm, key) ? fm[key] : undefined;

function reorder(items, moved, slot) {
  const source = items.indexOf(moved);
  if (source < 0 || new Set(items).size !== items.length || !Number.isInteger(slot) || slot < 0 || slot > items.length) {
    throw new Error('Invalid card insertion position.');
  }
  const result = items.filter(item => item !== moved);
  result.splice(slot > source ? slot - 1 : slot, 0, moved);
  return result;
}

function dropSlot(clientY, innerTop, height, gap, count) {
  if (![clientY, innerTop, height, gap].every(Number.isFinite) || height <= 0 || gap < 0) throw new Error('Unsupported Kanban geometry.');
  return Math.max(0, Math.min(count, Math.floor((clientY - innerTop + height / 2) / (height + gap))));
}

function snapshot(file, fm, settings) {
  const keys = settings.properties, property = settings.cardOrdering.property;
  if (file.extension !== 'md' || !fm || getDestination(file.parent?.path, fm, settings) !== file.parent?.path) {
    throw new Error('The column contains notes outside the configured project folders.');
  }
  const rank = value(fm, property);
  if (rank !== undefined && (typeof rank !== 'number' || !Number.isFinite(rank))) throw new Error('Card order must be a finite number or an absent property.');
  return { path: file.path, folder: file.parent.path, project: value(fm, keys.project), type: value(fm, keys.type),
    status: value(fm, keys.status), before: rank, had: own(fm, property) };
}

function planOrder(files, moved, slot, direction, settings, metadata, constraints = {}) {
  if (!files.length || files.length > MAX_COLUMN_SIZE || !['ASC', 'DESC'].includes(direction)) throw new Error('Unsupported column size or sort direction.');
  if (direction !== 'ASC') throw new Error('Set the card-order property to ascending in the Kanban Sort menu so the top card starts at 1.');
  const records = files.map(file => {
    const fm = metadata(file);
    return { file, ...snapshot(file, fm, settings), guards: (constraints.guardProperties ?? []).map(property => ({
      property, had: own(fm, property), json: JSON.stringify(value(fm, property))
    })) };
  });
  if (new Set(records.map(record => record.path)).size !== records.length) throw new Error('Duplicate cards.');
  if (records.some(record => record.project !== records[0].project || record.status !== records[0].status)) throw new Error('The column contains mixed projects or statuses.');
  let ordered;
  if (constraints.sameGroup) {
    const indices = files.map((file, index) => constraints.sameGroup(file, moved) ? index : -1).filter(index => index >= 0);
    const first = indices[0], last = indices[indices.length - 1];
    if (!indices.length || indices.length !== last - first + 1 || slot < first || slot > last + 1) {
      throw new Error('Move cards only within the same leading sort values. Put order first to reorder the entire column.');
    }
    const bucket = files.slice(first, last + 1), sortedBucket = reorder(bucket, moved, slot - first);
    // Keep other buckets in their displayed positions, not their old manual
    // rank positions. The whole displayed column is numbered 1..N after a drop.
    ordered = [...files.slice(0, first), ...sortedBucket, ...files.slice(last + 1)];
  } else {
    ordered = reorder(files, moved, slot);
  }
  const changes = ordered.map((file, index) => ({ ...records.find(record => record.file === file), after: index + 1, afterHad: true }))
    .filter(record => !record.had || record.before !== record.after);
  if (!changes.length) return null;
  return { property: settings.cardOrdering.property, keys: settings.properties, records, changes, leadingUnchanged: constraints.unchanged };
}

function matches(record, fm, plan, io) {
  return io.currentFile(record.file) && record.file.path === record.path && record.file.parent?.path === record.folder
    && value(fm, plan.keys.project) === record.project && value(fm, plan.keys.type) === record.type
    && value(fm, plan.keys.status) === record.status && own(fm, plan.property) === record.had
    && value(fm, plan.property) === record.before
    && (record.guards ?? []).every(guard => own(fm, guard.property) === guard.had && JSON.stringify(value(fm, guard.property)) === guard.json);
}

function assign(fm, property, rank, had) { if (had) fm[property] = rank; else delete fm[property]; }

// Multi-file updates are not atomic. Validate actual YAML, restore completed writes on
// failure, and never overwrite a later edit during recovery. No status/body edits.
async function applyOrder(plan, io, canRun) {
  const written = [];
  const allowed = () => canRun() && (!plan.leadingUnchanged || plan.leadingUnchanged());
  try {
    for (const record of plan.records) {
      if (!allowed() || !matches(record, await io.read(record.file), plan, io)) throw new Error('Cards or settings changed. Reorder cancelled.');
    }
    for (const record of plan.changes) {
      if (!allowed()) throw new Error('Card ordering disabled or settings changed.');
      await io.process(record.file, fm => {
        if (!allowed() || !matches(record, fm, plan, io)) throw new Error('A card changed while saving.');
        assign(fm, plan.property, record.after, record.afterHad);
      });
      written.push(record);
    }
    if (!allowed()) throw new Error('Card ordering disabled or settings changed.');
  } catch (error) {
    const failed = [];
    for (const record of written.reverse()) {
      try {
        await io.process(record.file, fm => {
          const current = { ...record, before: record.after, had: record.afterHad };
          if (!matches(current, fm, plan, io)) throw new Error('Concurrent edit');
          assign(fm, plan.property, record.before, record.had);
        });
      } catch { failed.push(record.path); }
    }
    if (failed.length) throw new Error(error.message + ' Automatic recovery incomplete; inspect: ' + failed.join(', '));
    throw error;
  }
  const reverse = plan.changes.map(record => ({ ...record, before: record.after, had: record.afterHad, after: record.before, afterHad: record.had }));
  return { ...plan, records: reverse, changes: reverse };
}

// These are deliberately guarded, undocumented Obsidian 1.14.4 structures.
// Never replace a native method or intercept a cross-column/file/column drag.
function orderingContext(app, settings, version, drag, target, native = {}) {
  if (!settings.cardOrdering?.enabled || version !== SUPPORTED_VERSION || drag?.type !== 'kanban-card') return null;
  const view = drag.view;
  if (!view || view.type !== 'kanban' || view.app !== app || view.isReadOnly || !Array.isArray(view.columns)) return null;
  const config = view.config, groupProperty = config?.groupBy?.property;
  if (![settings.properties.status, 'note.' + settings.properties.status].includes(groupProperty)) return null;
  if (typeof config.getSort !== 'function' || typeof config.getLimit !== 'function' || config.getLimit() !== 0
    || typeof view.queryController?.getSearchQuery !== 'function' || view.queryController.getSearchQuery()?.trim()) return null;
  const sort = config.getSort();
  if (!Array.isArray(sort) || sort.some(row => !row || typeof row.property !== 'string' || !['ASC', 'DESC'].includes(row.direction))) return null;
  const orderIds = [settings.cardOrdering.property, 'note.' + settings.cardOrdering.property];
  const positions = sort.map((row, index) => orderIds.includes(row.property) ? index : -1).filter(index => index >= 0);
  if (positions.length !== 1) return null;
  const orderIndex = positions[0], leading = sort.slice(0, orderIndex);
  const element = target?.closest?.('.bases-kanban-column');
  const column = view.columns.find(item => item.containerEl === element);
  if (!column || !column.innerEl || !column.group || column.group !== drag.sourceGroup || !Array.isArray(column.group.entries)
    || !column.group.entries.some(entry => entry.file === drag.entry?.file)) return null;
  const files = column.group.entries.map(entry => entry.file);
  if (files.length > MAX_COLUMN_SIZE || !Number.isFinite(view.measurements?.cardHeight) || !Number.isFinite(view.measurements?.cardGap)) return null;
  let constraints;
  if (leading.length) {
    if (typeof native.parsePropertyId !== 'function' || typeof native.equalValues !== 'function') return null;
    const parsed = leading.map(row => native.parsePropertyId(row.property));
    const managed = parsed.filter(prop => prop.type === 'formula').map(prop => ({ name: prop.name, property: managedSortProperty(prop.name, config, settings) }));
    // Derived formulas can depend on order itself; modification time and size also
    // change when YAML is saved. Do not promise stable reordering for those keys.
    if (managed.some(prop => !prop.property) || parsed.some(prop => prop.type === 'file' && ['mtime', 'size'].includes(prop.name))) {
      throw new Error('Reordering is not supported below arbitrary or outdated formulas, modified-time, or file-size sorts. Reapply custom value sorting or put order first.');
    }
    const keyIds = leading.map((row, index) => parsed[index].type === 'formula' ? 'note.' + managed.find(prop => prop.name === parsed[index].name).property : row.property);
    const entries = new Map(column.group.entries.map(entry => [entry.file, entry]));
    const keys = new Map(column.group.entries.map(entry => [entry.file, keyIds.map(id => entry.getValue(id))]));
    const equal = (a, b) => a.length === b.length && a.every((v, index) => native.equalValues(v, b[index]));
    constraints = { sameGroup: (a, b) => equal(keys.get(a), keys.get(b)),
      guardProperties: [...new Set([...parsed.filter(prop => prop.type === 'note').map(prop => prop.name), ...managed.map(prop => prop.property)])],
      unchanged: () => managed.every(prop => managedSortProperty(prop.name, config, settings) === prop.property)
        && files.every(file => equal(keys.get(file), keyIds.map(id => entries.get(file).getValue(id)))) };
  }
  return { view, column, files, moved: drag.entry.file, direction: sort[orderIndex].direction, constraints };
}

module.exports = { SUPPORTED_VERSION, reorder, dropSlot, planOrder, applyOrder, orderingContext };
