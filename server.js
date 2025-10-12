const express=require("express")
const path = require('path');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mongoose=require("mongoose")
const morgan=require("morgan")
const helmet=require("helmet")
const cors=require("cors")
const cookieParser = require('cookie-parser');
const compression = require('compression');
const http=require("http")
const AppError = require('./utils/appError');
require("dotenv").config()
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');

const app=express()
const server=http.createServer(app)
app.enable('trust proxy', 1);

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
// Serving static files
app.use(express.static(path.join(__dirname, 'public')));

// Set security HTTP headers
app.use(helmet()); 

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(compression());

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Limit requests from same API
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  keyGenerator: ipKeyGenerator,
  message: 'Too many requests from this IP, please try again in an hour!',
});
app.use('/api', limiter);

const orderRouter = require('./routes/orderRoutes');
const tenantRouter = require('./routes/tenantRoutes');
const refundStatRouter = require('./routes/refundStatRoutes');
const globalErrorHandler = require('./controllers/errorController');
const userRouter = require('./routes/userRoutes');
const webhookRoutes = require('./routes/webhook');
const refundRulesRouter = require('./routes/refundRulesRoutes');
const userAuditRouter = require('./routes/userAuditRoutes');

const allowedOrigins = [
  "http://localhost:5173",        // React dev server
  "https://refunds-app.vercel.app",
  "https://vercel.com/raghav-kumars-projects-e04ee19e/refunds-app/HHyxuJsYERDcP89jaGPZbsEtxRVR",
  "https://refunds-app.trytechit.co"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
app.use('/api/v1', orderRouter);
app.use('/api/v1/webhook', webhookRoutes);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/tenants', tenantRouter);
app.use('/api/v1/refund-rules', refundRulesRouter);
app.use('/api/v1/refund-stats', refundStatRouter);
app.use('/api/v1/user-audits', userAuditRouter);

// Serve Users-only OpenAPI spec and Swagger UI
try {
  const usersSpecPath = path.join(__dirname, 'docs', 'openapi.users.json');
  const usersOpenapi = JSON.parse(fs.readFileSync(usersSpecPath, 'utf-8'));
  app.get('/openapi.users.json', (req, res) => res.json(usersOpenapi));
  app.use('/api-docs/users', swaggerUi.serveFiles(usersOpenapi, {}), swaggerUi.setup(usersOpenapi));

} catch (e) {
  console.warn('Users Swagger docs not loaded:', e.message);
}
// Serve Tenants OpenAPI spec and Swagger UI
try {
  const tenantsSpecPath = path.join(__dirname, 'docs', 'openapi.tenants.json');
  const tenantsOpenapi = JSON.parse(fs.readFileSync(tenantsSpecPath, 'utf-8'));
  app.get('/openapi.tenants.json', (req, res) => res.json(tenantsOpenapi));
  app.use('/api-docs/tenants', swaggerUi.serveFiles(tenantsOpenapi, {}), swaggerUi.setup(tenantsOpenapi));
} catch (e) {
  console.warn('Tenants Swagger docs not loaded:', e.message);
}
// Serve Refund Rules OpenAPI spec and Swagger UI
try {
  const rrSpecPath = path.join(__dirname, 'docs', 'openapi.refund-rules.json');
  const rrOpenapi = JSON.parse(fs.readFileSync(rrSpecPath, 'utf-8'));
  app.get('/openapi.refund-rules.json', (req, res) => res.json(rrOpenapi));
  app.use('/api-docs/refund-rules', swaggerUi.serveFiles(rrOpenapi, {}), swaggerUi.setup(rrOpenapi));
} catch (e) {
  console.warn('Refund Rules Swagger docs not loaded:', e.message);
}
// Serve Orders/Refunds OpenAPI spec and Swagger UI
try {
  const refundsSpecPath = path.join(__dirname, 'docs', 'openapi.refunds.json');
  const refundsOpenapi = JSON.parse(fs.readFileSync(refundsSpecPath, 'utf-8'));
  app.get('/openapi.refunds.json', (req, res) => res.json(refundsOpenapi));
  app.use('/api-docs/refunds', swaggerUi.serveFiles(refundsOpenapi, {}), swaggerUi.setup(refundsOpenapi));
} catch (e) {
  console.warn('Refunds Swagger docs not loaded:', e.message);
}
// Serve Refund Stats OpenAPI spec and Swagger UI
try {
  const refStatsSpecPath = path.join(__dirname, 'docs', 'openapi.refund-stats.json');
  const refStatsOpenapi = JSON.parse(fs.readFileSync(refStatsSpecPath, 'utf-8'));
  app.get('/openapi.refund-stats.json', (req, res) => res.json(refStatsOpenapi));
  app.use('/api-docs/refund-stats', swaggerUi.serveFiles(refStatsOpenapi, {}), swaggerUi.setup(refStatsOpenapi));
} catch (e) {
  console.warn('Refund Stats Swagger docs not loaded:', e.message);
}
// Serve User Audit OpenAPI spec and Swagger UI
try {
  const uaSpecPath = path.join(__dirname, 'docs', 'openapi.user-audit.json');
  const uaOpenapi = JSON.parse(fs.readFileSync(uaSpecPath, 'utf-8'));
  app.get('/openapi.user-audit.json', (req, res) => res.json(uaOpenapi));
  app.use('/api-docs/user-audit', swaggerUi.serveFiles(uaOpenapi, {}), swaggerUi.setup(uaOpenapi));
} catch (e) {
  console.warn('User Audit Swagger docs not loaded:', e.message);
}
app.use(globalErrorHandler);

app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

const DB = process.env.DATABASE.replace(
  "<db_password>",
  process.env.DATABASE_PASSWORD
);

app.set("env", process.env.NODE_ENV);

mongoose
  .connect(DB, {
    maxPoolSize: 5,
  })
mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose disconnected");
});

const PORT=process.env.PORT || 5000
server.listen(PORT,()=>{
    console.log(`Server is running on port ${PORT}`)
})
