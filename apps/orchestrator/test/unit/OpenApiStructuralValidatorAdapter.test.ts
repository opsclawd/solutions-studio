import { describe, it, expect } from 'vitest';
import { OpenApiStructuralValidatorAdapter } from '../../src/infrastructure/validation/OpenApiStructuralValidatorAdapter.js';

describe('OpenApiStructuralValidatorAdapter', () => {
  const validator = new OpenApiStructuralValidatorAdapter();

  const validYaml = `
openapi: 3.1.0
info:
  title: Sample API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: A list of users
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/User'
components:
  schemas:
    User:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
        name:
          type: string
`;

  it('passes validation for a structurally valid OpenAPI 3.1 YAML document', async () => {
    const result = await validator.validate(validYaml);
    expect(result.isValid).toBe(true);
    expect(result.parsedDocument).toBeDefined();
    expect(result.parsedDocument?.openapi).toBe('3.1.0');
  });

  it('passes validation for a valid OpenAPI 3.1 JSON document', async () => {
    const jsonDoc = JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'JSON API', version: '2.0.0' },
      paths: {
        '/status': {
          get: {
            operationId: 'getStatus',
            responses: {
              '200': { description: 'OK' }
            }
          }
        }
      }
    });

    const result = await validator.validate(jsonDoc);
    expect(result.isValid).toBe(true);
    expect(result.parsedDocument?.openapi).toBe('3.1.0');
  });

  it('fails closed on an empty document', async () => {
    const result = await validator.validate('   ');
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('cannot be empty');
    expect(result.errorDetails?.[0].rule).toBe('empty-document');
  });

  it('fails closed on malformed YAML syntax with line and column info', async () => {
    const badYaml = 'openapi: 3.1.0\ninfo: [broken';
    const result = await validator.validate(badYaml);
    expect(result.isValid).toBe(false);
    expect(result.errorDetails?.[0].line).toBeDefined();
  });

  it('fails closed when openapi version is not 3.1.x', async () => {
    const v30 = validYaml.replace('openapi: 3.1.0', 'openapi: 3.0.3');
    const result = await validator.validate(v30);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('Only OpenAPI 3.1.x is supported');

    const v20 = validYaml.replace('openapi: 3.1.0', 'openapi: 2.0');
    const result2 = await validator.validate(v20);
    expect(result2.isValid).toBe(false);
  });

  it('fails closed when root info is missing title or version', async () => {
    const missingTitle = `
openapi: 3.1.0
info:
  version: 1.0.0
paths: {}
`;
    const result = await validator.validate(missingTitle);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("'title'");
  });

  it('fails closed when document has no paths, webhooks, or components', async () => {
    const emptyDoc = `
openapi: 3.1.0
info:
  title: Nothing
  version: 1.0.0
`;
    const result = await validator.validate(emptyDoc);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain(
      "declare at least one of 'paths', 'webhooks', or 'components'"
    );
  });

  it('fails closed when path key does not start with a forward slash', async () => {
    const badPath = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  users:
    get:
      responses:
        '200':
          description: ok
`;
    const result = await validator.validate(badPath);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("begin with a forward slash '/'");
  });

  it('fails closed on invalid HTTP method in path item', async () => {
    const badMethod = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /test:
    invalidMethod:
      responses:
        '200':
          description: ok
`;
    const result = await validator.validate(badMethod);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Invalid HTTP method 'invalidMethod'");
  });

  it('fails closed when operation responses object is missing or empty', async () => {
    const noResponses = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /test:
    get:
      operationId: testOp
      responses: {}
`;
    const result = await validator.validate(noResponses);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain(
      "declare a 'responses' object with at least one response definition"
    );
  });

  it('fails closed when path template parameter has no matching parameter definition', async () => {
    const missingParam = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /users/{userId}:
    get:
      responses:
        '200':
          description: ok
`;
    const result = await validator.validate(missingParam);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Missing path parameter declaration for '{userId}'");
  });

  it('fails closed when path parameter has required !== true', async () => {
    const notRequiredParam = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /users/{userId}:
    get:
      parameters:
        - name: userId
          in: path
          required: false
      responses:
        '200':
          description: ok
`;
    const result = await validator.validate(notRequiredParam);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('must have required: true');
  });

  it('fails closed on duplicate operationId across paths', async () => {
    const dupOpId = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: getItem
      responses:
        '200':
          description: ok
  /orders:
    get:
      operationId: getItem
      responses:
        '200':
          description: ok
`;
    const result = await validator.validate(dupOpId);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Duplicate operationId 'getItem'");
  });

  it('fails closed on unresolvable local $ref', async () => {
    const danglingRef = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NonExistentModel'
components:
  schemas: {}
`;
    const result = await validator.validate(danglingRef);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain(
      "Unresolvable $ref '#/components/schemas/NonExistentModel'"
    );
  });

  it('fails closed on circular schema alias chain', async () => {
    const circular = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /test:
    get:
      responses:
        '200':
          description: ok
components:
  schemas:
    Alpha:
      $ref: '#/components/schemas/Beta'
    Beta:
      $ref: '#/components/schemas/Alpha'
`;
    const result = await validator.validate(circular);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('Circular reference detected');
  });

  it('fails closed when required property is missing from schema properties', async () => {
    const missingProp = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /test:
    get:
      responses:
        '200':
          description: ok
components:
  schemas:
    Order:
      type: object
      required:
        - orderId
        - totalAmount
      properties:
        orderId:
          type: string
`;
    const result = await validator.validate(missingProp);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain(
      "Required property 'totalAmount' is not defined in properties"
    );
  });

  it('fails closed when array schema lacks items', async () => {
    const missingItems = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /test:
    get:
      responses:
        '200':
          description: ok
components:
  schemas:
    Tags:
      type: array
`;
    const result = await validator.validate(missingItems);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain(
      "Array schema at '#/components/schemas/Tags' must define an 'items' schema"
    );
  });

  it('fails closed on duplicate parameter declarations in the same operation', async () => {
    const dupParam = `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /search:
    get:
      parameters:
        - name: q
          in: query
        - name: q
          in: query
      responses:
        '200':
          description: ok
`;
    const result = await validator.validate(dupParam);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Duplicate parameter declaration 'q' in 'query'");
  });
});
