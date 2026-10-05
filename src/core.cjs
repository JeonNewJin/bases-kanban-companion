'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  version: 3,
  properties: Object.freeze({ project: 'project', status: 'status' }),
  cardOrdering: Object.freeze({ enabled: false, property: 'order' }),
  compactCards: Object.freeze({ enabled: false }),
  templates: Object.freeze({ folder: '' }),
  issueCounters: Object.freeze({}),
  valueSorts: Object.freeze([]),
  excludedFolders: Object.freeze([]),
  projects: Object.freeze([])
});
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

function cleanFolder(value) {
  if (typeof value !== 'string') throw new Error('Enter a vault-relative folder path.');
  const path = value.trim().replace(/\/+$/, '');
  if (!path || path.startsWith('/') || /[\\:*?"<>|\x00-\x1f]/.test(path)
    || path.split('/').some(part => !part || part.startsWith('.') || part.trim() !== part)) {
    throw new Error('Use a non-hidden, vault-relative folder path: ' + value);
  }
  return path;
}

function propertyName(value) {
  if (typeof value !== 'string') throw new Error('Enter a property name.');
  const name = value.trim();
  if (!name || name.length > 128 || /[\x00-\x1f]/.test(name)
    || ['__proto__', 'constructor', 'prototype'].includes(name)) {
    throw new Error('Invalid property name: ' + value);
  }
  return name;
}

function projectName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]+$/.test(value.trim())) throw new Error('Project names must contain English letters only (A–Z).');
  return value.trim().toUpperCase();
}

function validateCounters(input) {
  if (!isObject(input)) throw new Error('Invalid issue counters.');
  const counters = {};
  for (const [name, number] of Object.entries(input)) {
    if (!/^[A-Z]+$/.test(name) || !Number.isSafeInteger(number) || number < 0) throw new Error('Invalid issue counter: ' + name);
    counters[name] = number;
  }
  return counters;
}

function validateSettings(input, { preserveProjectNames = false } = {}) {
  if (!isObject(input) || !Array.isArray(input.projects)) throw new Error('Invalid project settings.');
  const keys = input.properties ?? DEFAULT_SETTINGS.properties;
  if (!isObject(keys)) throw new Error('Invalid property settings.');
  const properties = {
    project: propertyName(keys.project), status: propertyName(keys.status)
  };
  if (properties.project === properties.status) {
    throw new Error('Project and status property names must be distinct.');
  }
  const ordering = input.cardOrdering ?? DEFAULT_SETTINGS.cardOrdering;
  if (!isObject(ordering) || typeof ordering.enabled !== 'boolean') throw new Error('Invalid card-order settings.');
  const cardOrdering = { enabled: ordering.enabled, property: propertyName(ordering.property) };
  const compact = input.compactCards === undefined ? DEFAULT_SETTINGS.compactCards : input.compactCards;
  if (!isObject(compact) || typeof compact.enabled !== 'boolean') throw new Error('Invalid card-layout settings.');
  const compactCards = { enabled: compact.enabled };
  const templateInput = input.templates === undefined ? DEFAULT_SETTINGS.templates : input.templates;
  if (!isObject(templateInput) || typeof templateInput.folder !== 'string') throw new Error('Invalid template folder settings.');
  const templates = { folder: templateInput.folder.trim() ? cleanFolder(templateInput.folder) : '' };
  const issueCounters = validateCounters(input.issueCounters === undefined ? {} : input.issueCounters);
  if ([properties.project, properties.status, cardOrdering.property].includes('issue_id')) {
    throw new Error('issue_id is reserved for automatically assigned issue identifiers.');
  }
  if ([properties.project, properties.status].includes(cardOrdering.property)) {
    throw new Error('The card-order property must differ from project and status.');
  }
  const rules = input.valueSorts ?? [];
  if (!Array.isArray(rules) || rules.length > 20) throw new Error('Add at most 20 custom value-sort rules.');
  const ruleProperties = new Set();
  const valueSorts = rules.map(rule => {
    if (!isObject(rule)) throw new Error('Invalid value-sort rule.');
    const property = propertyName(rule.property);
    if (property === 'issue_id') throw new Error('issue_id is reserved for automatically assigned issue identifiers.');
    if ([properties.project, properties.status, cardOrdering.property].includes(property) || ruleProperties.has(property)) {
      throw new Error('Value-sort properties must be unique and differ from routing and card-order properties.');
    }
    ruleProperties.add(property);
    if (!Array.isArray(rule.values) || !rule.values.length || rule.values.length > 50) throw new Error(property + ': add 1–50 text values.');
    const values = rule.values.map(value => {
      if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f]/.test(value)) throw new Error(property + ': enter non-empty text values.');
      return value.trim();
    });
    if (new Set(values).size !== values.length) throw new Error(property + ': values must be unique.');
    const label = rule.displayName ?? '';
    if (typeof label !== 'string' || label.length > 128 || /[\x00-\x1f]/.test(label)) throw new Error(property + ': use a single-line sort option name of up to 128 characters.');
    return { property, values, displayName: label.trim() };
  });
  const excluded = input.excludedFolders ?? [];
  if (!Array.isArray(excluded)) throw new Error('Excluded folders must be a list.');
  const excludedFolders = [...new Set(excluded.map(cleanFolder))];
  const names = new Set();
  const projects = input.projects.map(project => {
    if (!isObject(project) || typeof project.name !== 'string') throw new Error('Enter a project name.');
    const name = preserveProjectNames ? project.name.trim() : projectName(project.name);
    if (!name || names.has(name)) throw new Error('Project names must be non-empty and unique.');
    names.add(name);
    if (!Array.isArray(project.routes) || !project.routes.length) throw new Error(name + ': add at least one status.');
    const statuses = new Set();
    const routes = project.routes.map(route => {
      if (!isObject(route) || typeof route.status !== 'string') throw new Error(name + ': enter a status.');
      const status = route.status.trim();
      if (!status || statuses.has(status)) throw new Error(name + ': status names must be non-empty and unique.');
      statuses.add(status);
      return { status, folder: cleanFolder(route.folder) };
    });
    return { name, enabled: project.enabled !== false, newTaskFolder: cleanFolder(project.newTaskFolder), routes };
  });
  return { version: 3, properties, cardOrdering, compactCards, templates, issueCounters, valueSorts, excludedFolders, projects };
}

function migrateSettings(input) {
  if (input == null) return clone(DEFAULT_SETTINGS);
  if (!isObject(input)) throw new Error('Settings must be a JSON object.');
  if (input.version === 2) {
    return validateSettings({ ...input, properties: DEFAULT_SETTINGS.properties, excludedFolders: [] }, { preserveProjectNames: true });
  }
  if (input.version !== 3) throw new Error('Unsupported settings version. Expected 2 or 3.');
  return validateSettings(input, { preserveProjectNames: true });
}

function isExcluded(folder, settings) {
  return settings.excludedFolders.some(path => folder === path || folder.startsWith(path + '/'));
}

function getDestination(folder, frontmatter, settings = DEFAULT_SETTINGS) {
  if (!isObject(frontmatter) || typeof folder !== 'string' || isExcluded(folder, settings)) return null;
  const keys = settings.properties;
  const project = settings.projects.find(item => item.enabled && item.name === own(frontmatter, keys.project));
  if (!project || ![project.newTaskFolder, ...project.routes.map(route => route.folder)].includes(folder)) return null;
  const destination = project.routes.find(route => route.status === own(frontmatter, keys.status))?.folder;
  return destination && !isExcluded(destination, settings) ? destination : null;
}

function selectedProject(name, settings) {
  const project = settings.projects.find(item => item.enabled && item.name === name);
  if (!project) throw new Error('Choose an enabled project.');
  if (isExcluded(project.newTaskFolder, settings)) throw new Error('The new-task folder is excluded.');
  return project;
}

function taskFrontmatter(projectName, settings) {
  const project = selectedProject(projectName, settings);
  const keys = settings.properties;
  const result = { [keys.project]: project.name };
  result[keys.status] = project.routes[0].status;
  return result;
}

function taskPath(projectName, title, settings) {
  const project = selectedProject(projectName, settings);
  if (typeof title !== 'string') throw new Error('Enter a task title.');
  const name = title.trim().replace(/\.md$/i, '').trim();
  if (!name || name.startsWith('.') || /[\\/:*?"<>|\x00-\x1f]/.test(name)) {
    throw new Error('Enter a valid note title without path separators.');
  }
  return project.newTaskFolder + '/' + name + '.md';
}

module.exports = { DEFAULT_SETTINGS, clone, cleanFolder, projectName, validateCounters, validateSettings, migrateSettings, getDestination, taskFrontmatter, taskPath };
