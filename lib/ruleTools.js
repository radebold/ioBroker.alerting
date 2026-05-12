'use strict';

function normalizeRuleId(id) {
    return String(id || 'rule')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'rule';
}

function parseJsonMaybe(value, fallback) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return value;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return fallback;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
    }
}

function convertValue(value, valueType) {
    if (valueType === 'number') {
        if (value === null || value === undefined || value === '') return NaN;
        return Number(value);
    }
    if (valueType === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return ['true', '1', 'on', 'yes', 'ja', 'ein'].includes(normalized);
        }
        return Boolean(value);
    }
    if (valueType === 'string') {
        return value === null || value === undefined ? '' : String(value);
    }
    if (valueType === 'json') {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }
        return value;
    }
    return value;
}

function stateVal(cache, stateId) {
    const state = cache.get(stateId);
    return state ? state.val : undefined;
}

function collectStateIds(node, result = new Set()) {
    if (!node || typeof node !== 'object') return result;

    if (node.state) result.add(node.state);
    if (node.valueState) result.add(node.valueState);

    const items = Array.isArray(node.items) ? node.items : Array.isArray(node.conditions) ? node.conditions : [];
    for (const item of items) collectStateIds(item, result);

    return result;
}

function compare(leftRaw, operator, rightRaw) {
    switch (operator) {
        case 'eq':
        case '==':
        case '=':
            return leftRaw === rightRaw;
        case 'ne':
        case '!=':
        case '<>':
            return leftRaw !== rightRaw;
        case 'gt':
        case '>':
            return Number(leftRaw) > Number(rightRaw);
        case 'gte':
        case '>=':
            return Number(leftRaw) >= Number(rightRaw);
        case 'lt':
        case '<':
            return Number(leftRaw) < Number(rightRaw);
        case 'lte':
        case '<=':
            return Number(leftRaw) <= Number(rightRaw);
        case 'contains':
            return String(leftRaw ?? '').includes(String(rightRaw ?? ''));
        case 'notContains':
            return !String(leftRaw ?? '').includes(String(rightRaw ?? ''));
        case 'regex':
            return new RegExp(String(rightRaw)).test(String(leftRaw ?? ''));
        case 'exists':
            return leftRaw !== undefined && leftRaw !== null;
        case 'notExists':
            return leftRaw === undefined || leftRaw === null;
        case 'isEmpty':
            return leftRaw === undefined || leftRaw === null || leftRaw === '';
        case 'notEmpty':
            return !(leftRaw === undefined || leftRaw === null || leftRaw === '');
        case 'true':
        case 'isTrue':
            return convertValue(leftRaw, 'boolean') === true;
        case 'false':
        case 'isFalse':
            return convertValue(leftRaw, 'boolean') === false;
        default:
            throw new Error(`Unsupported operator "${operator}"`);
    }
}

function evaluateCondition(node, cache) {
    if (!node || typeof node !== 'object') {
        throw new Error('Invalid condition node');
    }

    const op = String(node.op || '').toLowerCase();
    const items = Array.isArray(node.items) ? node.items : Array.isArray(node.conditions) ? node.conditions : [];

    if (op === 'and') {
        return items.every(item => evaluateCondition(item, cache));
    }

    if (op === 'or') {
        return items.some(item => evaluateCondition(item, cache));
    }

    if (op === 'not') {
        if (items.length !== 1) throw new Error('NOT condition needs exactly one item');
        return !evaluateCondition(items[0], cache);
    }

    if (!node.state) {
        throw new Error('Leaf condition needs a state');
    }

    const valueType = node.valueType || 'auto';
    const left = convertValue(stateVal(cache, node.state), valueType);
    const rightSource = node.valueState ? stateVal(cache, node.valueState) : node.value;
    const right = convertValue(rightSource, valueType);
    return compare(left, node.operator || 'eq', right);
}

function renderTemplate(value, context) {
    if (Array.isArray(value)) return value.map(item => renderTemplate(item, context));
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            result[key] = renderTemplate(entry, context);
        }
        return result;
    }
    if (typeof value !== 'string') return value;

    return value.replace(/\$\{([^}]+)\}/g, (_match, token) => {
        const key = String(token).trim();
        if (key.startsWith('state:')) {
            const id = key.slice(6);
            const val = stateVal(context.stateCache, id);
            return val === undefined || val === null ? '' : String(val);
        }
        switch (key) {
            case 'rule.id':
                return context.rule.id || '';
            case 'rule.name':
                return context.rule.name || context.rule.id || '';
            case 'message.title':
                return context.messageTitle || '';
            case 'message.text':
                return context.messageText || '';
            case 'changed.id':
                return context.changed?.id || '';
            case 'changed.value':
                return context.changed?.state ? String(context.changed.state.val) : '';
            case 'now':
                return new Date(context.now).toISOString();
            default:
                return '';
        }
    });
}

module.exports = {
    normalizeRuleId,
    parseJsonMaybe,
    convertValue,
    collectStateIds,
    evaluateCondition,
    renderTemplate,
};
