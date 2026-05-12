'use strict';

const utils = require('@iobroker/adapter-core');
const {
    normalizeRuleId,
    parseJsonMaybe,
    convertValue,
    collectStateIds,
    evaluateCondition,
    renderTemplate,
} = require('./lib/ruleTools');

class Alerting extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'alerting' });

        this.rules = [];
        this.stateCache = new Map();
        this.ruleRuntime = new Map();
        this.stateToRuleIds = new Map();
        this.subscribedStates = new Set();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setState('info.connection', true, true);
        await this.setState('info.lastError', '', true);

        if (this.config.enabled === false) {
            this.log.info('Adapter is disabled in configuration.');
            return;
        }

        try {
            await this.loadRules();
            await this.createRuleObjects();
            await this.subscribeUsedStates();
            await this.readInitialStates();

            if (this.config.evaluateOnStart !== false) {
                await this.evaluateAll({ reason: 'startup', allowSend: this.config.sendOnStartup === true });
            }

            this.log.info(`Alerting adapter started with ${this.rules.length} enabled rule(s).`);
        } catch (error) {
            await this.setState('info.lastError', error.message, true);
            this.log.error(error.stack || error.message);
        }
    }

    async onUnload(callback) {
        try {
            await this.setState('info.connection', false, true);
            callback();
        } catch {
            callback();
        }
    }

    async loadRules() {
        const rawRules = parseJsonMaybe(this.config.rulesJson, []);
        if (!Array.isArray(rawRules)) {
            throw new Error('rulesJson must be a JSON array');
        }

        this.rules = rawRules
            .filter(rule => rule && rule.enabled !== false)
            .map((rule, index) => {
                const id = rule.id || `rule_${index + 1}`;
                const condition = rule.condition || rule.criteria || rule.when;
                if (!condition) throw new Error(`Rule "${id}" has no condition`);

                const stateIds = Array.from(collectStateIds(condition));
                if (!stateIds.length) throw new Error(`Rule "${id}" uses no states`);

                return {
                    ...rule,
                    id,
                    key: normalizeRuleId(id),
                    name: rule.name || id,
                    condition,
                    stateIds,
                    limits: {
                        maxMessages: Number(rule.limits?.maxMessages ?? this.config.defaultMaxMessages ?? 1),
                        minIntervalSec: Number(rule.limits?.minIntervalSec ?? this.config.defaultMinIntervalSec ?? 300),
                    },
                    channels: Array.isArray(rule.channels) ? rule.channels.filter(ch => ch && ch.enabled !== false) : [],
                    actions: Array.isArray(rule.actions) ? rule.actions.filter(action => action && action.enabled !== false) : [],
                };
            });

        this.stateToRuleIds.clear();
        for (const rule of this.rules) {
            this.ruleRuntime.set(rule.id, this.ruleRuntime.get(rule.id) || {
                active: false,
                sentCount: 0,
                lastSent: 0,
                activeSince: 0,
            });

            for (const stateId of rule.stateIds) {
                const set = this.stateToRuleIds.get(stateId) || new Set();
                set.add(rule.id);
                this.stateToRuleIds.set(stateId, set);
            }
        }
    }

    async createRuleObjects() {
        for (const rule of this.rules) {
            const base = `rules.${rule.key}`;
            await this.setObjectNotExistsAsync(base, {
                type: 'channel',
                common: { name: rule.name },
                native: { ruleId: rule.id },
            });

            await this.setObjectNotExistsAsync(`${base}.active`, {
                type: 'state',
                common: { name: 'Rule is active', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.sentCount`, {
                type: 'state',
                common: { name: 'Sent messages in current active phase', type: 'number', role: 'value', read: true, write: false, def: 0 },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.lastEvaluation`, {
                type: 'state',
                common: { name: 'Last evaluation timestamp', type: 'number', role: 'date', read: true, write: false, def: 0 },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.lastTrigger`, {
                type: 'state',
                common: { name: 'Last trigger timestamp', type: 'number', role: 'date', read: true, write: false, def: 0 },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.lastMessage`, {
                type: 'state',
                common: { name: 'Last notification text', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.lastSuppressedReason`, {
                type: 'state',
                common: { name: 'Last suppressed reason', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.lastError`, {
                type: 'state',
                common: { name: 'Last rule error', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
        }
    }

    async subscribeUsedStates() {
        for (const stateId of this.stateToRuleIds.keys()) {
            if (!this.subscribedStates.has(stateId)) {
                await this.subscribeForeignStatesAsync(stateId);
                this.subscribedStates.add(stateId);
                this.log.debug(`Subscribed foreign state ${stateId}`);
            }
        }
    }

    async readInitialStates() {
        for (const stateId of this.stateToRuleIds.keys()) {
            try {
                const state = await this.getForeignStateAsync(stateId);
                if (state) this.stateCache.set(stateId, state);
            } catch (error) {
                this.log.warn(`Cannot read state ${stateId}: ${error.message}`);
            }
        }
    }

    async onStateChange(id, state) {
        if (!state) return;
        if (!this.stateToRuleIds.has(id)) return;

        this.stateCache.set(id, state);

        const ruleIds = this.stateToRuleIds.get(id) || new Set();
        for (const ruleId of ruleIds) {
            const rule = this.rules.find(item => item.id === ruleId);
            if (rule) {
                await this.evaluateRule(rule, {
                    reason: 'stateChange',
                    allowSend: true,
                    changed: { id, state },
                });
            }
        }
    }

    async evaluateAll(options = {}) {
        for (const rule of this.rules) {
            await this.evaluateRule(rule, options);
        }
    }

    async evaluateRule(rule, options = {}) {
        const now = Date.now();
        const base = `rules.${rule.key}`;
        const runtime = this.ruleRuntime.get(rule.id) || { active: false, sentCount: 0, lastSent: 0, activeSince: 0 };

        await this.setState(`${base}.lastEvaluation`, now, true);
        await this.setState('info.lastEvaluation', now, true);

        let matches = false;
        try {
            matches = evaluateCondition(rule.condition, this.stateCache);
            await this.setState(`${base}.lastError`, '', true);
        } catch (error) {
            await this.setState(`${base}.lastError`, error.message, true);
            await this.setState('info.lastError', error.message, true);
            this.log.warn(`Rule "${rule.id}" could not be evaluated: ${error.message}`);
            return;
        }

        if (!matches) {
            if (runtime.active) {
                await this.runActions(rule, 'onFalse', options, now);
                this.log.info(`Rule "${rule.name}" is no longer active. Message counter reset.`);
            }
            runtime.active = false;
            runtime.sentCount = 0;
            runtime.lastSent = 0;
            runtime.activeSince = 0;
            this.ruleRuntime.set(rule.id, runtime);
            await this.setState(`${base}.active`, false, true);
            await this.setState(`${base}.sentCount`, 0, true);
            await this.setState(`${base}.lastSuppressedReason`, '', true);
            return;
        }

        const becameActive = !runtime.active;
        if (becameActive) {
            runtime.active = true;
            runtime.sentCount = 0;
            runtime.lastSent = 0;
            runtime.activeSince = now;
            await this.runActions(rule, 'onTrue', options, now);
            await this.setState(`${base}.lastTrigger`, now, true);
            this.log.info(`Rule "${rule.name}" became active.`);
        }

        await this.runActions(rule, 'everyTrue', options, now);
        await this.setState(`${base}.active`, true, true);

        if (options.allowSend === false) {
            await this.setState(`${base}.lastSuppressedReason`, 'Sending disabled for this evaluation', true);
            this.ruleRuntime.set(rule.id, runtime);
            return;
        }

        const maxMessages = Number.isFinite(rule.limits.maxMessages) ? rule.limits.maxMessages : 1;
        const minIntervalMs = Math.max(0, Number(rule.limits.minIntervalSec || 0) * 1000);

        if (maxMessages <= 0) {
            await this.setState(`${base}.lastSuppressedReason`, 'maxMessages is 0', true);
            this.ruleRuntime.set(rule.id, runtime);
            return;
        }

        if (runtime.sentCount >= maxMessages) {
            await this.setState(`${base}.lastSuppressedReason`, `Maximum message count reached (${maxMessages})`, true);
            this.ruleRuntime.set(rule.id, runtime);
            return;
        }

        if (runtime.lastSent && now - runtime.lastSent < minIntervalMs) {
            const waitSec = Math.ceil((minIntervalMs - (now - runtime.lastSent)) / 1000);
            await this.setState(`${base}.lastSuppressedReason`, `Minimum interval not reached (${waitSec}s remaining)`, true);
            this.ruleRuntime.set(rule.id, runtime);
            return;
        }

        const sent = await this.sendNotifications(rule, options, now);
        if (sent > 0) {
            runtime.sentCount += sent;
            runtime.lastSent = now;
            await this.setState(`${base}.sentCount`, runtime.sentCount, true);
            await this.setState(`${base}.lastSuppressedReason`, '', true);
        }

        this.ruleRuntime.set(rule.id, runtime);
    }

    buildMessage(rule, options, now) {
        const rawTitle = rule.message?.title ?? rule.name;
        const rawText = rule.message?.text ?? `Rule "${rule.name}" is active.`;
        const context = {
            rule,
            now,
            changed: options.changed,
            stateCache: this.stateCache,
            messageTitle: '',
            messageText: '',
        };
        const title = renderTemplate(rawTitle, context);
        context.messageTitle = title;
        const text = renderTemplate(rawText, context);
        context.messageText = text;
        return { title, text, context };
    }

    async sendNotifications(rule, options, now) {
        const { title, text, context } = this.buildMessage(rule, options, now);
        context.messageTitle = title;
        context.messageText = text;
        let sent = 0;

        for (const channel of rule.channels) {
            try {
                if (channel.type === 'sendTo') {
                    const payloadTemplate = channel.payload ?? { text };
                    const payload = renderTemplate(payloadTemplate, context);
                    await this.sendToTarget(channel.instance, channel.command || 'send', payload);
                    sent += 1;
                } else if (channel.type === 'state') {
                    const valueTemplate = channel.value ?? text;
                    const rendered = renderTemplate(valueTemplate, context);
                    const converted = convertValue(rendered, channel.valueType || 'string');
                    await this.setForeignStateAsync(channel.state, converted, channel.ack === true);
                    sent += 1;
                } else {
                    this.log.warn(`Rule "${rule.id}" has unsupported channel type "${channel.type}"`);
                }
            } catch (error) {
                this.log.error(`Rule "${rule.id}" channel failed: ${error.message}`);
                await this.setState(`rules.${rule.key}.lastError`, error.message, true);
            }
        }

        if (sent > 0) {
            await this.setState(`rules.${rule.key}.lastMessage`, text, true);
            this.log.info(`Rule "${rule.name}" sent ${sent} notification(s).`);
        } else if (!rule.channels.length) {
            this.log.warn(`Rule "${rule.name}" matched but has no enabled channels.`);
        }

        return sent;
    }

    async sendToTarget(instance, command, payload) {
        if (!instance) throw new Error('sendTo channel needs an instance, e.g. telegram.0');

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ timeout: true });
                }
            }, 5000);

            try {
                this.sendTo(instance, command, payload, result => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeout);
                        resolve(result);
                    }
                });
            } catch (error) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            }
        });
    }

    async runActions(rule, when, options, now) {
        const { title, text, context } = this.buildMessage(rule, options, now);
        context.messageTitle = title;
        context.messageText = text;

        for (const action of rule.actions) {
            if ((action.when || 'onTrue') !== when) continue;

            try {
                if (action.type === 'setState') {
                    if (!action.state) throw new Error('setState action needs a state');
                    const rendered = renderTemplate(action.value, context);
                    const converted = convertValue(rendered, action.valueType || 'auto');
                    await this.setForeignStateAsync(action.state, converted, action.ack === true);
                    this.log.debug(`Rule "${rule.id}" action set ${action.state}=${JSON.stringify(converted)}`);
                } else {
                    this.log.warn(`Rule "${rule.id}" has unsupported action type "${action.type}"`);
                }
            } catch (error) {
                this.log.error(`Rule "${rule.id}" action failed: ${error.message}`);
                await this.setState(`rules.${rule.key}.lastError`, error.message, true);
            }
        }
    }
}

if (require.main !== module) {
    module.exports = options => new Alerting(options);
} else {
    new Alerting();
}
