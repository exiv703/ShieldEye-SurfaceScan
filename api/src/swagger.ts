import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ShieldEye API',
      version: '1.0.0',
      description: 'AI-Powered Web Security Scanner API',
      contact: {
        name: 'ShieldEye Team',
        email: 'support@shieldeye.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://api.shieldeye.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        }
      },
      schemas: {
        Scan: {
          type: 'object',
          required: ['id', 'url', 'status', 'createdAt'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique scan identifier'
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Target URL to scan'
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed'],
              description: 'Current scan status'
            },
            scanType: {
              type: 'string',
              enum: ['basic', 'comprehensive', 'ai-enhanced'],
              description: 'Type of scan performed'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Scan creation timestamp'
            },
            completedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Scan completion timestamp'
            },
            results: {
              $ref: '#/components/schemas/ScanResults'
            }
          }
        },
        ScanResults: {
          type: 'object',
          properties: {
            vulnerabilities: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Vulnerability'
              }
            },
            dependencies: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Dependency'
              }
            },
            aiAnalysis: {
              $ref: '#/components/schemas/AIAnalysis'
            },
            blockchainVerification: {
              $ref: '#/components/schemas/BlockchainVerification'
            },
            quantumAnalysis: {
              $ref: '#/components/schemas/QuantumAnalysis'
            }
          }
        },
        Vulnerability: {
          type: 'object',
          required: ['id', 'severity', 'title', 'description'],
          properties: {
            id: {
              type: 'string',
              description: 'Vulnerability identifier (CVE, GHSA, etc.)'
            },
            severity: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low', 'info'],
              description: 'Vulnerability severity level'
            },
            title: {
              type: 'string',
              description: 'Vulnerability title'
            },
            description: {
              type: 'string',
              description: 'Detailed vulnerability description'
            },
            cvssScore: {
              type: 'number',
              minimum: 0,
              maximum: 10,
              description: 'CVSS score'
            },
            affectedPackage: {
              type: 'string',
              description: 'Name of affected package'
            },
            fixedVersion: {
              type: 'string',
              description: 'Version that fixes the vulnerability'
            }
          }
        },
        AIAnalysis: {
          type: 'object',
          properties: {
            threatLevel: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'AI-assessed threat level'
            },
            behaviorAnalysis: {
              type: 'object',
              properties: {
                anomalies: {
                  type: 'array',
                  items: { type: 'string' }
                },
                riskScore: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100
                }
              }
            },
            predictions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  probability: { type: 'number' },
                  timeframe: { type: 'string' }
                }
              }
            }
          }
        },
        Error: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Error code'
                },
                message: {
                  type: 'string',
                  description: 'Human-readable error message'
                },
                requestId: {
                  type: 'string',
                  description: 'Request identifier for tracking'
                }
              }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./src/routes/*.ts', './src/index.ts']
};

const specs = swaggerJsdoc(options);

export const setupSwagger = (app: Express) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'ShieldEye API Documentation'
  }));
  
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });
};

export { specs };
