'use strict';

const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { createAuthDirectory } = require('./auth-state');

const TEMPLATE_STORE_KEY = 'whatsapp_templates';
const MAX_MESSAGE_LENGTH = 4096;
const MAX_MAGIC_LINK_URL_LENGTH = 2048;
const MAX_MAGIC_LINK_EXPIRY_SECONDS = 86_400;
const MAX_TEMPLATE_COUNT = 200;
const PERMISSIONS = Object.freeze({
  overview: 'plugin::magic-whatsapp.overview.access',
  status: 'plugin::magic-whatsapp.status.view',
  connection: 'plugin::magic-whatsapp.connection.manage',
  templates: 'plugin::magic-whatsapp.templates.list',
  manageTemplates: 'plugin::magic-whatsapp.templates.edit',
  send: 'plugin::magic-whatsapp.messages.send',
});

const ERROR_MESSAGES = Object.freeze({
  BAILEYS_UNAVAILABLE: 'The WhatsApp transport is unavailable on this Strapi instance.',
  AUTH_STATE_UNAVAILABLE: 'WhatsApp authentication storage is unavailable.',
  TRANSPORT_CONNECT_FAILED: 'WhatsApp could not be connected. Check the provider configuration and try again.',
  TRANSPORT_CONNECT_TIMEOUT: 'WhatsApp did not connect in time. Try again.',
  TRANSPORT_DISCONNECT_FAILED: 'WhatsApp could not be disconnected cleanly. Restart the provider if the problem continues.',
  TRANSPORT_LOGOUT_FAILED: 'The WhatsApp session could not be removed. Try again.',
  TRANSPORT_SEND_FAILED: 'The message could not be sent. Check the connection and try again.',
  TRANSPORT_LOOKUP_FAILED: 'The WhatsApp number could not be checked. Try again.',
  RECIPIENT_NOT_REGISTERED: 'This number is not registered on WhatsApp.',
  NOT_CONNECTED: 'Connect WhatsApp before using this action.',
  INVALID_RECIPIENT: 'Enter a valid international phone number.',
  INVALID_MESSAGE: 'Enter a message of up to 4,096 characters.',
  INVALID_LOGIN_URL: 'Use a valid HTTPS login URL, or HTTP on localhost, up to 2,048 characters.',
  INVALID_EXPIRY: 'The login link expiry must be between 1 second and 24 hours.',
  INVALID_TEMPLATE: 'Check the template name, language and message body.',
  INVALID_TEMPLATE_VARIABLES: 'Template variables must be plain text values.',
  TEMPLATE_ALREADY_EXISTS: 'A template with this identifier already exists.',
  TEMPLATE_NOT_FOUND: 'The requested template was not found.',
  TEMPLATE_STORE_UNAVAILABLE: 'Templates could not be loaded or saved. Try again.',
  TEMPLATE_LIMIT_REACHED: 'The template limit has been reached.',
  TEMPLATE_VARIABLE_MISSING: 'A value is missing for a template placeholder.',
  RATE_LIMITED: 'Too many WhatsApp messages were sent in a short time. Wait a minute and try again.',
  SOCKET_UNAVAILABLE: 'The WhatsApp socket could not be created.',
});

const ERROR_STATUS = Object.freeze({
  BAILEYS_UNAVAILABLE: 503,
  AUTH_STATE_UNAVAILABLE: 500,
  TRANSPORT_CONNECT_FAILED: 502,
  TRANSPORT_CONNECT_TIMEOUT: 504,
  TRANSPORT_DISCONNECT_FAILED: 502,
  TRANSPORT_LOGOUT_FAILED: 502,
  TRANSPORT_SEND_FAILED: 502,
  TRANSPORT_LOOKUP_FAILED: 502,
  RECIPIENT_NOT_REGISTERED: 422,
  NOT_CONNECTED: 409,
  INVALID_RECIPIENT: 400,
  INVALID_MESSAGE: 400,
  INVALID_TEMPLATE: 400,
  INVALID_TEMPLATE_VARIABLES: 400,
  TEMPLATE_ALREADY_EXISTS: 409,
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_STORE_UNAVAILABLE: 503,
  TEMPLATE_LIMIT_REACHED: 409,
  TEMPLATE_VARIABLE_MISSING: 400,
  RATE_LIMITED: 429,
  SOCKET_UNAVAILABLE: 503,
});

const createPublicError = (code) => {
  const error = new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.TRANSPORT_CONNECT_FAILED);
  error.code = ERROR_MESSAGES[code] ? code : 'TRANSPORT_CONNECT_FAILED';
  error.status = ERROR_STATUS[error.code] || 502;
  return error;
};

const normalizeRecipient = (value) => {
  if (typeof value !== 'string' || !/^\+[1-9]\d{7,14}$/.test(value)) {
    throw createPublicError('INVALID_RECIPIENT');
  }
  return value.slice(1);
};

const validateMessage = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_MESSAGE_LENGTH) {
    throw createPublicError('INVALID_MESSAGE');
  }
  return value;
};

const validateMagicLinkPayload = ({ phoneNumber, loginUrl, expiresInSeconds } = {}) => {
  normalizeRecipient(phoneNumber);
  if (
    typeof loginUrl !== 'string' || loginUrl.length === 0 || loginUrl.length > MAX_MAGIC_LINK_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(loginUrl)
  ) {
    throw createPublicError('INVALID_LOGIN_URL');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(loginUrl);
  } catch {
    throw createPublicError('INVALID_LOGIN_URL');
  }
  const isLocalHttp = parsedUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
  if ((parsedUrl.protocol !== 'https:' && !isLocalHttp) || parsedUrl.username || parsedUrl.password) {
    throw createPublicError('INVALID_LOGIN_URL');
  }

  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_MAGIC_LINK_EXPIRY_SECONDS) {
    throw createPublicError('INVALID_EXPIRY');
  }

  return { phoneNumber, loginUrl: parsedUrl.href, expiresInSeconds };
};

const validateTemplateId = (value) => {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw createPublicError('INVALID_TEMPLATE');
  }
  return value;
};

const validateTemplate = (value, id = value?.id) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createPublicError('INVALID_TEMPLATE');
  const templateId = validateTemplateId(id);
  const allowedKeys = new Set(['id', 'name', 'language', 'body']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw createPublicError('INVALID_TEMPLATE');

  const name = value.name;
  const language = value.language;
  const body = value.body;
  if (
    typeof name !== 'string' || name.trim().length === 0 || name.length > 80
    || typeof language !== 'string' || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)
    || typeof body !== 'string' || body.trim().length === 0 || body.length > MAX_MESSAGE_LENGTH
  ) {
    throw createPublicError('INVALID_TEMPLATE');
  }

  return { id: templateId, name: name.trim(), language, body };
};

const createDefaultAuthDirectory = (strapi) => {
  const appRoot = path.resolve(strapi.dirs?.app?.root || process.cwd());
  const appKey = createHash('sha256').update(appRoot).digest('hex').slice(0, 24);
  const baseDirectory = path.join(os.homedir(), '.strapi', 'magic-whatsapp', appKey);
  return createAuthDirectory({ baseDirectory });
};

const getSilentPinoLogger = (baileysModule) => {
  const packageRequire = createRequire(__filename);
  const baileysPackage = packageRequire.resolve('baileys/package.json');
  const baileysRequire = createRequire(baileysPackage);
  const pino = baileysRequire('pino');
  return pino({ level: 'silent', redact: { paths: ['*'], censor: '[redacted]' } });
};

const createWhatsAppService = ({
  strapi,
  loadBaileys = async () => import('baileys'),
  socketFactory,
  authDirectory,
  qrEncoder = async (qr) => require('qrcode').toDataURL(qr, { width: 280, margin: 2 }),
  logger,
  connectTimeoutMs = 30_000,
  reconnectDelays = [1_000, 3_000, 9_000],
} = {}) => {
  if (!strapi || typeof strapi.store !== 'function') throw new TypeError('A Strapi instance is required.');

  const authDirectoryStore = authDirectory
    ? (typeof authDirectory === 'string' ? createAuthDirectory({ baseDirectory: path.dirname(authDirectory) }) : authDirectory)
    : createDefaultAuthDirectory(strapi);
  const authPath = typeof authDirectory === 'string' ? authDirectory : authDirectoryStore.directory;
  let pluginStore;
  const store = () => {
    if (!pluginStore) pluginStore = strapi.store({ type: 'plugin', name: 'magic-whatsapp' });
    return pluginStore;
  };

  let status = 'disconnected';
  let lastError = null;
  let pairingQr = null;
  let socket = null;
  let baileys;
  let connectPromise = null;
  let previouslyConnected = false;
  let manuallyClosing = false;
  let stopping = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let templateQueue = Promise.resolve();

  const getStatus = () => ({
    state: status,
    isConnected: status === 'connected',
    lastError: lastError ? { ...lastError } : null,
  });

  const safeLog = (level, code) => {
    try {
      strapi.log?.[level]?.('Magic WhatsApp operation failed', { code });
    } catch {
      // Logging must never surface a provider error or disrupt transport cleanup.
    }
  };

  const mapProviderError = (code, error) => {
    const mappedCode = error?.code === 'AUTH_STATE_UNAVAILABLE' || error?.code === 'BAILEYS_UNAVAILABLE'
      ? error.code
      : code;
    safeLog('warn', mappedCode);
    return createPublicError(mappedCode);
  };

  const setFailure = (code) => {
    const error = createPublicError(code);
    lastError = { code: error.code, message: error.message };
    status = 'error';
    pairingQr = null;
    safeLog('warn', error.code);
    return error;
  };

  const withTemplateLock = (operation) => {
    const pending = templateQueue.then(operation, operation);
    templateQueue = pending.catch(() => {});
    return pending;
  };

  const readTemplates = async () => {
    try {
      const value = await store().get({ key: TEMPLATE_STORE_KEY });
      if (!Array.isArray(value)) return [];
      return value.filter((template) => {
        try {
          validateTemplate(template);
          return true;
        } catch {
          return false;
        }
      }).map((template) => ({ ...template }));
    } catch (error) {
      throw mapProviderError('TEMPLATE_STORE_UNAVAILABLE', error);
    }
  };

  const writeTemplates = async (templates) => {
    try {
      await store().set({ key: TEMPLATE_STORE_KEY, value: templates });
    } catch (error) {
      throw mapProviderError('TEMPLATE_STORE_UNAVAILABLE', error);
    }
  };

  const requireConnectedSocket = () => {
    if (status !== 'connected' || !socket) throw createPublicError('NOT_CONNECTED');
    return socket;
  };

  const closeSocket = async ({ logout = false, clearListeners = true } = {}) => {
    const activeSocket = socket;
    socket = null;
    pairingQr = null;
    if (!activeSocket) return;

    if (clearListeners && activeSocket.ev?.removeAllListeners) activeSocket.ev.removeAllListeners();
    if (logout && typeof activeSocket.logout === 'function') {
      await activeSocket.logout();
    } else if (typeof activeSocket.end === 'function') {
      await activeSocket.end(undefined);
    } else if (typeof activeSocket.ws?.close === 'function') {
      activeSocket.ws.close();
    }
  };

  const scheduleReconnect = () => {
    if (stopping || manuallyClosing || reconnectTimer || reconnectAttempts >= reconnectDelays.length) return;
    const delay = reconnectDelays[reconnectAttempts];
    reconnectAttempts += 1;
    status = 'connecting';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      service.connect().catch(() => {});
    }, delay);
    reconnectTimer.unref?.();
  };

  const disconnectReason = (error) => error?.output?.statusCode;

  const handleConnectionUpdate = async (update, resolveConnection, rejectConnection, isSettled) => {
    if (update?.qr && !stopping) {
      try {
        pairingQr = await qrEncoder(update.qr);
        status = 'qr_pending';
        lastError = null;
        if (!isSettled()) resolveConnection({ ...getStatus(), qrCode: pairingQr });
      } catch (error) {
        const safeError = setFailure('TRANSPORT_CONNECT_FAILED');
        if (!isSettled()) rejectConnection(safeError);
      }
    }

    if (update?.connection === 'open') {
      status = 'connected';
      previouslyConnected = true;
      manuallyClosing = false;
      reconnectAttempts = 0;
      pairingQr = null;
      lastError = null;
      if (!isSettled()) resolveConnection(getStatus());
    }

    if (update?.connection === 'close') {
      const reason = disconnectReason(update.lastDisconnect?.error);
      const closedSocket = socket;
      socket = null;
      closedSocket?.ev?.removeAllListeners?.();
      pairingQr = null;
      const loggedOut = reason === baileys?.DisconnectReason?.loggedOut;
      status = loggedOut ? 'disconnected' : 'error';
      lastError = loggedOut
        ? { code: 'SESSION_LOGGED_OUT', message: 'The WhatsApp session has ended. Pair this Strapi instance again.' }
        : { code: 'TRANSPORT_CONNECTION_CLOSED', message: 'The WhatsApp connection closed. Check the provider and try again.' };
      safeLog('warn', lastError.code);

      if (!isSettled()) rejectConnection(createPublicError('TRANSPORT_CONNECT_FAILED'));
      else if (
        (reason === baileys?.DisconnectReason?.restartRequired || previouslyConnected)
        && !loggedOut && !manuallyClosing && !stopping
      ) scheduleReconnect();
    }
  };

  const connect = async () => {
    if (status === 'connected') return getStatus();
    if (status === 'qr_pending') return { ...getStatus(), qrCode: pairingQr };
    if (connectPromise) return connectPromise;

    manuallyClosing = false;
    status = 'connecting';
    lastError = null;
    connectPromise = (async () => {
      let settled = false;
      let timeout;
      let resolveConnection;
      let rejectConnection;
      const connectionResult = new Promise((resolve, reject) => {
        resolveConnection = (value) => { settled = true; resolve(value); };
        rejectConnection = (error) => { settled = true; reject(error); };
        timeout = setTimeout(() => rejectConnection(setFailure('TRANSPORT_CONNECT_TIMEOUT')), connectTimeoutMs);
        timeout.unref?.();
      });

      try {
        baileys = await loadBaileys();
        if (typeof baileys?.useMultiFileAuthState !== 'function') throw Object.assign(new Error(), { code: 'BAILEYS_UNAVAILABLE' });
        await authDirectoryStore.ensure();
        const { state: auth, saveCreds } = await baileys.useMultiFileAuthState(authPath);
        const createSocket = socketFactory || ((options) => {
          const factory = baileys.default?.default || baileys.default || baileys.makeWASocket;
          if (typeof factory !== 'function') throw Object.assign(new Error(), { code: 'SOCKET_UNAVAILABLE' });
          return factory(options);
        });
        const socketLogger = logger || getSilentPinoLogger(baileys);
        const browser = baileys.Browsers?.ubuntu?.('Chrome');
        socket = await createSocket({
          auth,
          logger: socketLogger,
          ...(browser ? { browser } : {}),
          syncFullHistory: false,
          markOnlineOnConnect: false,
          generateHighQualityLinkPreview: false,
          printQRInTerminal: false,
          getMessage: async () => ({ conversation: '' }),
        }, { baileys, authDirectory: authPath });

        if (!socket?.ev || typeof socket.ev.on !== 'function') throw Object.assign(new Error(), { code: 'SOCKET_UNAVAILABLE' });
        const activeSocket = socket;
        socket.ev.on('connection.update', (update) => {
          handleConnectionUpdate(update, resolveConnection, rejectConnection, () => settled).catch(() => {
            const error = setFailure('TRANSPORT_CONNECT_FAILED');
            if (!settled) rejectConnection(error);
          });
        });
        socket.ev.on('creds.update', () => {
          Promise.resolve(saveCreds()).catch(() => safeLog('warn', 'AUTH_STATE_UNAVAILABLE'));
        });

        const result = await connectionResult;
        if (activeSocket !== socket && result.state !== 'error') return getStatus();
        return result;
      } catch (error) {
        const code = error.code === 'BAILEYS_UNAVAILABLE' ? 'BAILEYS_UNAVAILABLE'
          : error.code === 'AUTH_STATE_UNAVAILABLE' ? 'AUTH_STATE_UNAVAILABLE'
            : error.code === 'SOCKET_UNAVAILABLE' ? 'SOCKET_UNAVAILABLE'
              : error.code === 'TRANSPORT_CONNECT_TIMEOUT' ? 'TRANSPORT_CONNECT_TIMEOUT'
              : 'TRANSPORT_CONNECT_FAILED';
        const safeError = setFailure(code);
        try { await closeSocket(); } catch { /* provider details stay private */ }
        throw safeError;
      } finally {
        clearTimeout(timeout);
        connectPromise = null;
      }
    })();

    return connectPromise;
  };

  const service = {
    getStatus,

    getPairingQrCode() {
      return status === 'qr_pending' ? pairingQr : null;
    },

    async connect() {
      return connect();
    },

    async disconnect() {
      manuallyClosing = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        await closeSocket();
        status = 'disconnected';
        lastError = null;
        previouslyConnected = false;
        return getStatus();
      } catch (error) {
        throw setFailure('TRANSPORT_DISCONNECT_FAILED');
      }
    },

    async logout() {
      manuallyClosing = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        await closeSocket({ logout: true });
        await authDirectoryStore.clear();
        status = 'disconnected';
        lastError = null;
        previouslyConnected = false;
        return getStatus();
      } catch (error) {
        throw setFailure(error.code === 'AUTH_STATE_UNAVAILABLE' ? 'AUTH_STATE_UNAVAILABLE' : 'TRANSPORT_LOGOUT_FAILED');
      }
    },

    async shutdown() {
      stopping = true;
      manuallyClosing = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { await closeSocket(); } catch { /* shutdown is best-effort */ }
      pairingQr = null;
      status = 'disconnected';
      stopping = false;
    },

    async sendMessage(input = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw createPublicError('INVALID_MESSAGE');
      const { recipient, text } = input;
      const digits = normalizeRecipient(recipient);
      const message = validateMessage(text);
      const activeSocket = requireConnectedSocket();
      let recipientStatus;
      try {
        [recipientStatus] = await activeSocket.onWhatsApp(`${digits}@s.whatsapp.net`);
      } catch (error) {
        throw mapProviderError('TRANSPORT_LOOKUP_FAILED', error);
      }
      if (recipientStatus?.exists !== true) throw createPublicError('RECIPIENT_NOT_REGISTERED');
      try {
        await activeSocket.sendMessage(`${digits}@s.whatsapp.net`, { text: message });
        return { sent: true };
      } catch (error) {
        throw mapProviderError('TRANSPORT_SEND_FAILED', error);
      }
    },

    async sendMagicLink(input = {}) {
      const { phoneNumber, loginUrl, expiresInSeconds } = validateMagicLinkPayload(input);
      const expiry = expiresInSeconds < 60
        ? `${expiresInSeconds} Sekunden`
        : `${Math.ceil(expiresInSeconds / 60)} Minuten`;
      const text = `Dein Login-Link:\n${loginUrl}\n\nDer Link ist ${expiry} gültig. Teile ihn mit niemandem.`;
      if (text.length > MAX_MESSAGE_LENGTH) throw createPublicError('INVALID_LOGIN_URL');
      await service.sendMessage({ recipient: phoneNumber, text });
      return { success: true };
    },

    async sendTemplateMessage(input = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw createPublicError('INVALID_TEMPLATE');
      const { recipient, templateId, variables = {} } = input;
      const id = validateTemplateId(templateId);
      if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
        throw createPublicError('INVALID_TEMPLATE_VARIABLES');
      }
      const entries = Object.entries(variables);
      if (entries.length > 30 || entries.some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key)
        || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 512)) {
        throw createPublicError('INVALID_TEMPLATE_VARIABLES');
      }
      const templates = await readTemplates();
      const template = templates.find((entry) => entry.id === id);
      if (!template) throw createPublicError('TEMPLATE_NOT_FOUND');
      const variableMap = new Map(entries.map(([key, value]) => [key, String(value)]));
      const body = template.body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]{0,63})\s*\}\}/g, (placeholder, key) => {
        if (!variableMap.has(key)) throw createPublicError('TEMPLATE_VARIABLE_MISSING');
        return variableMap.get(key);
      });
      return service.sendMessage({ recipient, text: body });
    },

    async checkNumber(recipient) {
      const digits = normalizeRecipient(recipient);
      const activeSocket = requireConnectedSocket();
      try {
        const [result] = await activeSocket.onWhatsApp(`${digits}@s.whatsapp.net`);
        return { exists: result?.exists === true };
      } catch (error) {
        throw mapProviderError('TRANSPORT_LOOKUP_FAILED', error);
      }
    },

    async getTemplates() {
      return readTemplates();
    },

    async createTemplate(input) {
      const template = validateTemplate(input);
      return withTemplateLock(async () => {
        const templates = await readTemplates();
        if (templates.some((entry) => entry.id === template.id)) throw createPublicError('TEMPLATE_ALREADY_EXISTS');
        if (templates.length >= MAX_TEMPLATE_COUNT) throw createPublicError('TEMPLATE_LIMIT_REACHED');
        templates.push(template);
        await writeTemplates(templates);
        return { ...template };
      });
    },

    async updateTemplate(id, changes) {
      const templateId = validateTemplateId(id);
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)
        || Object.keys(changes).length === 0
        || Object.keys(changes).some((key) => !['name', 'language', 'body'].includes(key))) {
        throw createPublicError('INVALID_TEMPLATE');
      }
      return withTemplateLock(async () => {
        const templates = await readTemplates();
        const index = templates.findIndex((entry) => entry.id === templateId);
        if (index === -1) throw createPublicError('TEMPLATE_NOT_FOUND');
        const updated = validateTemplate({ ...templates[index], ...changes }, templateId);
        templates[index] = updated;
        await writeTemplates(templates);
        return { ...updated };
      });
    },

    async deleteTemplate(id) {
      const templateId = validateTemplateId(id);
      return withTemplateLock(async () => {
        const templates = await readTemplates();
        const remaining = templates.filter((entry) => entry.id !== templateId);
        if (remaining.length === templates.length) throw createPublicError('TEMPLATE_NOT_FOUND');
        await writeTemplates(remaining);
        return true;
      });
    },
  };

  return service;
};

const serviceFactory = ({ strapi }, dependencies = {}) => {
  const config = strapi.config?.get?.('plugin::magic-whatsapp') || {};
  const configuredFactory = config.socketFactory;
  const options = { ...dependencies, strapi };
  if (typeof configuredFactory === 'function') options.socketFactory = (socketOptions, context) => configuredFactory(socketOptions, context);
  return createWhatsAppService(options);
};

serviceFactory.createWhatsAppService = createWhatsAppService;
serviceFactory.PERMISSIONS = PERMISSIONS;
serviceFactory.validateTemplate = validateTemplate;
serviceFactory.ERROR_MESSAGES = ERROR_MESSAGES;
serviceFactory.ERROR_STATUS = ERROR_STATUS;
serviceFactory.createPublicError = createPublicError;
serviceFactory.validateMagicLinkPayload = validateMagicLinkPayload;

module.exports = serviceFactory;
