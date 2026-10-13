'use strict';

const whatsappService = require('../services/whatsapp');
const { createSendRateLimiter } = require('../services/send-rate-limiter');

const controllerError = (error) => {
  const known = typeof error?.code === 'string' && Object.hasOwn(whatsappService.ERROR_MESSAGES, error.code);
  const code = known ? error.code : 'TRANSPORT_CONNECT_FAILED';
  return {
    status: whatsappService.ERROR_STATUS[code] || 502,
    body: {
      error: {
        code,
        message: whatsappService.ERROR_MESSAGES[code],
      },
    },
  };
};

const withResult = (strapi, handler, successStatus = 200) => async (ctx) => {
  try {
    const result = await handler(ctx, strapi.plugin('magic-whatsapp').service('whatsapp'));
    ctx.status = successStatus;
    ctx.body = { data: result };
  } catch (error) {
    const response = controllerError(error);
    ctx.status = response.status;
    ctx.body = response.body;
  }
};

const requireObjectBody = (ctx, code) => {
  const body = ctx.request?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw whatsappService.createPublicError(code);
  return body;
};

module.exports = ({ strapi, sendRateLimiter = createSendRateLimiter() }) => {
  const allowSend = (ctx) => {
    const identity = ctx.state?.user?.id ?? ctx.state?.auth?.credentials?.id ?? 'authenticated-admin';
    if (!sendRateLimiter.consume(identity)) throw whatsappService.createPublicError('RATE_LIMITED');
  };

  return {
    status: withResult(strapi, (_ctx, service) => service.getStatus()),

    connect: withResult(strapi, (_ctx, service) => service.connect()),

    pairingQr: withResult(strapi, (_ctx, service) => service.getPairingQrCode()),

    disconnect: withResult(strapi, (_ctx, service) => service.disconnect()),

    logout: withResult(strapi, (_ctx, service) => service.logout()),

    templates: withResult(strapi, (_ctx, service) => service.getTemplates()),

    createTemplate: withResult(strapi, (ctx, service) => service.createTemplate(requireObjectBody(ctx, 'INVALID_TEMPLATE')), 201),

    updateTemplate: withResult(strapi, (ctx, service) => service.updateTemplate(ctx.params.id, requireObjectBody(ctx, 'INVALID_TEMPLATE'))),

    deleteTemplate: withResult(strapi, (ctx, service) => service.deleteTemplate(ctx.params.id)),

    sendMessage: withResult(strapi, (ctx, service) => {
      allowSend(ctx);
      return service.sendMessage(requireObjectBody(ctx, 'INVALID_MESSAGE'));
    }, 202),

    sendTemplate: withResult(strapi, (ctx, service) => {
      allowSend(ctx);
      return service.sendTemplateMessage(requireObjectBody(ctx, 'INVALID_TEMPLATE'));
    }, 202),
  };
};
