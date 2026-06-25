export const getOpenApiSpec = (cfg) => ({
  openapi: '3.1.0',
  info: {
    title: 'Baileys WhatsApp Send API',
    version: '1.0.0',
    description: `Production-ready WhatsApp REST API powered by Baileys. Send text, images, documents, audio, and location messages through WhatsApp with built-in anti-ban protection.

**Features:**
- One-time QR scan — no repeated authentication
- Anti-ban protection (random delays, typing simulation, burst pauses, daily limits)
- Message queuing for bulk sends
- API key authentication
- Campaign management`,
    contact: {
      name: 'Mohammad Rameez Imdad',
      url: 'https://www.youtube.com/@rameezimdad'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: cfg.publicDomain ? `https://${cfg.publicDomain}` : 'http://localhost:3000',
      description: cfg.publicDomain ? 'Production server' : 'Local development'
    }
  ],
  security: [
    { ApiKeyAuth: [] }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Your API key (format: wapi_xxxxxxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)'
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Alternative: pass API key as Bearer token in Authorization header'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          code: { type: 'string', example: 'AUTH_REQUIRED' },
          message: { type: 'string', example: 'API key is required' }
        }
      },
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' }
        }
      },
      SendMessageRequest: {
        type: 'object',
        required: ['to', 'message'],
        properties: {
          to: {
            type: 'string',
            description: 'Recipient phone number (country code + number, no +)',
            example: '923001234567'
          },
          message: {
            type: 'string',
            description: 'Text message content',
            example: 'Hello from API!'
          }
        }
      },
      SendLocationRequest: {
        type: 'object',
        required: ['to', 'latitude', 'longitude'],
        properties: {
          to: { type: 'string', example: '923001234567' },
          latitude: { type: 'number', example: 24.8607 },
          longitude: { type: 'number', example: 67.0011 },
          name: { type: 'string', example: 'My Location' },
          address: { type: 'string', example: '123 Main Street' }
        }
      }
    }
  },
  paths: {
    '/healthz': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        whatsapp: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/status': {
      get: {
        tags: ['WhatsApp'],
        summary: 'Get WhatsApp connection status',
        responses: {
          '200': {
            description: 'Connection status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['connected', 'connecting', 'disconnected', 'error'] },
                        connected: { type: 'boolean' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/qr': {
      get: {
        tags: ['WhatsApp'],
        summary: 'Get QR code for WhatsApp linking',
        parameters: [
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'png'] },
            description: 'Response format (default: json)'
          }
        ],
        responses: {
          '200': {
            description: 'QR code data'
          }
        }
      }
    },
    '/api/logout': {
      post: {
        tags: ['WhatsApp'],
        summary: 'Logout WhatsApp session (admin only)',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Session logged out'
          }
        }
      }
    },
    '/api/send-message': {
      post: {
        tags: ['Messages'],
        summary: 'Send a text message',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SendMessageRequest' }
            }
          }
        },
        responses: {
          '201': { description: 'Message sent' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/send-image': {
      post: {
        tags: ['Messages'],
        summary: 'Send an image message',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['to', 'file'],
                properties: {
                  to: { type: 'string', example: '923001234567' },
                  file: { type: 'string', format: 'binary' },
                  caption: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Image sent' }
        }
      }
    },
    '/api/send-document': {
      post: {
        tags: ['Messages'],
        summary: 'Send a document message',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['to', 'file'],
                properties: {
                  to: { type: 'string', example: '923001234567' },
                  file: { type: 'string', format: 'binary' },
                  caption: { type: 'string' },
                  fileName: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Document sent' }
        }
      }
    },
    '/api/send-audio': {
      post: {
        tags: ['Messages'],
        summary: 'Send an audio message',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['to', 'file'],
                properties: {
                  to: { type: 'string', example: '923001234567' },
                  file: { type: 'string', format: 'binary' },
                  ptt: { type: 'boolean', description: 'Send as voice note' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Audio sent' }
        }
      }
    },
    '/api/send-location': {
      post: {
        tags: ['Messages'],
        summary: 'Send a location pin',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SendLocationRequest' }
            }
          }
        },
        responses: {
          '201': { description: 'Location sent' }
        }
      }
    },
    '/api/messages': {
      get: {
        tags: ['Messages'],
        summary: 'List sent messages',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['sent', 'failed', 'queued', 'pending'] }
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 }
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 }
          }
        ],
        responses: {
          '200': { description: 'Message list' }
        }
      }
    },
    '/api/me': {
      get: {
        tags: ['Account'],
        summary: 'Get current API key info',
        responses: {
          '200': {
            description: 'Key details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        role: { type: 'string' },
                        prefix: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/server-info': {
      get: {
        tags: ['Account'],
        summary: 'Get server information',
        responses: {
          '200': { description: 'Server info' }
        }
      }
    },
    '/api/campaigns/recent': {
      get: {
        tags: ['Campaigns'],
        summary: 'List recent campaign reports',
        responses: {
          '200': { description: 'Campaign list' }
        }
      }
    },
    '/api/admin/generate-key': {
      post: {
        tags: ['Admin'],
        summary: 'Generate a new API key (admin only)',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Key label/name' },
                  role: { type: 'string', enum: ['api', 'admin'], default: 'api' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Key created' }
        }
      }
    },
    '/api/admin/revoke-key': {
      post: {
        tags: ['Admin'],
        summary: 'Revoke an API key (admin only)',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id'],
                properties: {
                  id: { type: 'string', description: 'Key ID to revoke' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Key revoked' }
        }
      }
    },
    '/api/admin/list-keys': {
      get: {
        tags: ['Admin'],
        summary: 'List all API keys (admin only)',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': { description: 'Key list' }
        }
      }
    }
  }
})
