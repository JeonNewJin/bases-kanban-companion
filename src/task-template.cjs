'use strict';

const { cleanFolder } = require('./core.cjs');

function templateMatches(path, folder) {
  if (typeof path !== 'string' || !/\.md$/i.test(path)) return false;
  try {
    if (cleanFolder(path) !== path) return false;
    return !folder || path.startsWith(cleanFolder(folder) + '/');
  } catch { return false; }
}

function taskFromTemplate(content, title, overrides, api) {
  if (typeof content !== 'string') throw new Error('Cannot read the template.');
  if (content.includes('<%')) throw new Error('Templater scripts are not supported. Choose a plain Markdown template.');
  const info = api.getFrontMatterInfo(content);
  if (!info.exists && /^\uFEFF?---(?:\r?\n|$)/.test(content)) throw new Error('Template frontmatter needs a closing delimiter.');
  let properties = {};
  if (info.exists) {
    try { properties = info.frontmatter.trim() ? api.parseYaml(info.frontmatter) : {}; }
    catch (error) { throw new Error('Invalid template frontmatter: ' + error.message); }
    if (Object.prototype.toString.call(properties) !== '[object Object]') throw new Error('Template frontmatter must be a property map.');
  }
  const render = value => value.replace(/\{\{(title|date|time)(?::([^{}]+))?\}\}/g, (match, variable, format) => {
    if (variable === 'title') return format ? match : title;
    return api.now.format(format || (variable === 'date' ? 'YYYY-MM-DD' : 'HH:mm'));
  });
  const visiting = new WeakSet();
  const transform = (value, depth = 0) => {
    if (typeof value === 'string') return render(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth > 50 || visiting.has(value)) throw new Error('Template properties are too deeply nested or recursive.');
    if (Object.prototype.toString.call(value) === '[object Date]') return value;
    if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') throw new Error('Unsupported template property value.');
    visiting.add(value);
    const result = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe template property: ' + key);
      result[key] = transform(child, depth + 1);
    }
    visiting.delete(value);
    return result;
  };
  const merged = { ...transform(properties), ...overrides };
  const yaml = api.stringifyYaml(merged).replace(/\n?$/, '\n');
  const body = render(content.slice(info.exists ? info.contentStart : 0).replace(/^\uFEFF/, ''));
  return '---\n' + yaml + '---\n' + body;
}

module.exports = { templateMatches, taskFromTemplate };
