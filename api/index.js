'use strict';

const { handler, ensureStorage } = require('../server');

let storageReady;

module.exports = async function vercelHandler(request, response) {
  storageReady ||= ensureStorage();
  await storageReady;
  return handler(request, response);
};
