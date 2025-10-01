// routes/rulesRoutes.js
const express = require("express");
const auth = require("../controllers/authController");
const tenantMiddleware = require("../middlewares/tenantMiddleware");
const rules = require("../controllers/refundRulesController");

const router = express.Router();
const secure = [auth.protect, tenantMiddleware];

router.get("/active", secure, rules.getActive);
router.get("/versions", secure, rules.listVersions);
router.post("/publish", secure, rules.publish);
router.post("/simulate", secure, rules.simulate);
router.post("/deactivate", secure, rules.deactivateActive);

// (optional) expose factory CRUD for admins
router
  .route("/")
  .get(secure, rules.getAllRefundRules)
  .post(secure, rules.createRefundRules);

router
  .route("/:id")
  .get(secure, rules.getRefundRules)
  .patch(secure, rules.updateRefundRules)
  .delete(secure, rules.deleteRefundRules);

module.exports = router;
