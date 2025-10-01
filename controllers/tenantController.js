const factory = require('./handlerFactory');
const Tenant = require('../models/tenantModel');

// Basic CRUD via handlerFactory
exports.createTenant = factory.createOne(Tenant);
exports.getTenant = factory.getOne(Tenant);
exports.getAllTenants = factory.getAll(Tenant);
exports.updateTenant = factory.updateOne(Tenant);
exports.deleteTenant = factory.deleteOne(Tenant);
