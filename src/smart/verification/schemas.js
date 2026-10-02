const PARTITION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          articleIds: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: {
              type: 'string'
            }
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        },
        required: ['articleIds'],
        additionalProperties: false
      }
    },
    uncertain: {
      type: 'boolean'
    }
  },
  required: ['clusters', 'uncertain'],
  additionalProperties: false
};

const COMPONENT_REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    exactEventGroups: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          componentIds: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string' }
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        },
        required: ['componentIds', 'confidence'],
        additionalProperties: false
      }
    },
    relatedDevelopments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          componentIds: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            uniqueItems: true,
            items: { type: 'string' }
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        },
        required: ['componentIds', 'confidence'],
        additionalProperties: false
      }
    },
    uncertain: { type: 'boolean' }
  },
  required: ['exactEventGroups', 'relatedDevelopments', 'uncertain'],
  additionalProperties: false
};

export { PARTITION_RESPONSE_SCHEMA, COMPONENT_REVIEW_RESPONSE_SCHEMA };
