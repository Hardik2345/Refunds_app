const express = require('express');
const router = express.Router();

const { handleRewardsWebhook } = require('../controllers/webhookController');

router.post('/rewards', express.json({ type: '*/*' }), handleRewardsWebhook);

module.exports = router;
