import { parserTools } from '../src/tools/parser';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

describe('Parser Tools', () => {
  const testYamlPath = path.join('/tmp', 'test.yaml');
  const testJsonPath = path.join('/tmp', 'test.json');

  afterEach(() => {
    // Clean up test files
    [testYamlPath, testJsonPath].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  describe('parse_yaml', () => {
    it('should parse valid YAML to JSON', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_yaml');
      expect(tool).toBeDefined();

      const yamlContent = `
name: Test
version: 1.0
features:
  - feature1
  - feature2
`;

      const result = await tool!.handler({ yamlContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.name).toBe('Test');
      expect(parsed.version).toBe(1.0);
      expect(parsed.features).toEqual(['feature1', 'feature2']);
    });

    it('should handle complex YAML structures', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_yaml');

      const yamlContent = `
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: secret
servers:
  - name: server1
    ip: 192.168.1.1
  - name: server2
    ip: 192.168.1.2
`;

      const result = await tool!.handler({ yamlContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.database.host).toBe('localhost');
      expect(parsed.database.credentials.username).toBe('admin');
      expect(parsed.servers).toHaveLength(2);
    });
  });

  describe('parse_json', () => {
    it('should parse and format valid JSON', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_json');

      const jsonContent = '{"name":"Test","value":123,"enabled":true}';

      const result = await tool!.handler({ jsonContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.name).toBe('Test');
      expect(parsed.value).toBe(123);
      expect(parsed.enabled).toBe(true);
    });

    it('should handle nested JSON objects', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_json');

      const jsonContent = JSON.stringify({
        user: {
          name: 'John',
          profile: {
            age: 30,
            city: 'NYC',
          },
        },
      });

      const result = await tool!.handler({ jsonContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.user.name).toBe('John');
      expect(parsed.user.profile.age).toBe(30);
    });

    it('should throw error for invalid JSON', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_json');

      const invalidJson = '{"name": "Test", invalid}';

      await expect(tool!.handler({ jsonContent: invalidJson })).rejects.toThrow();
    });
  });

  describe('parse_xml', () => {
    it('should parse XML to JSON', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_xml');

      const xmlContent = `
<?xml version="1.0"?>
<user>
  <name>John Doe</name>
  <email>john@example.com</email>
  <age>30</age>
</user>
`;

      const result = await tool!.handler({ xmlContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.user).toBeDefined();
      expect(parsed.user.name[0]).toBe('John Doe');
      expect(parsed.user.email[0]).toBe('john@example.com');
    });

    it('should handle XML with attributes', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_xml');

      const xmlContent = `
<product id="123" category="electronics">
  <name>Laptop</name>
  <price currency="USD">999.99</price>
</product>
`;

      const result = await tool!.handler({ xmlContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.product).toBeDefined();
      expect(parsed.product.$.id).toBe('123');
      expect(parsed.product.$.category).toBe('electronics');
    });
  });

  describe('parse_csv', () => {
    it('should parse CSV with default delimiter', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_csv');

      const csvContent = `name,age,city
John,30,NYC
Jane,25,LA
Bob,35,SF`;

      const result = await tool!.handler({ csvContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].name).toBe('John');
      expect(parsed[0].age).toBe('30');
      expect(parsed[1].name).toBe('Jane');
      expect(parsed[2].city).toBe('SF');
    });

    it('should parse CSV with custom delimiter', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_csv');

      const csvContent = `name;age;city
John;30;NYC
Jane;25;LA`;

      const result = await tool!.handler({ csvContent, delimiter: ';' });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('John');
      expect(parsed[0].age).toBe('30');
    });

    it('should skip empty lines', async () => {
      const tool = parserTools.find((t) => t.name === 'parse_csv');

      const csvContent = `name,age,city
John,30,NYC

Jane,25,LA

`;

      const result = await tool!.handler({ csvContent });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('yaml_to_json', () => {
    it('should convert YAML file to JSON file', async () => {
      const tool = parserTools.find((t) => t.name === 'yaml_to_json');

      // Create YAML file
      const yamlContent = `
name: TestApp
version: 2.0
settings:
  debug: true
  port: 8080
`;
      fs.writeFileSync(testYamlPath, yamlContent, 'utf8');

      const result = await tool!.handler({
        yamlPath: testYamlPath,
        jsonPath: testJsonPath,
      });

      expect(result.content[0].text).toContain('YAML converted to JSON');
      expect(fs.existsSync(testJsonPath)).toBe(true);

      const jsonContent = fs.readFileSync(testJsonPath, 'utf8');
      const parsed = JSON.parse(jsonContent);
      expect(parsed.name).toBe('TestApp');
      expect(parsed.version).toBe(2.0);
      expect(parsed.settings.debug).toBe(true);
    });
  });

  describe('json_to_yaml', () => {
    it('should convert JSON file to YAML file', async () => {
      const tool = parserTools.find((t) => t.name === 'json_to_yaml');

      // Create JSON file
      const jsonData = {
        app: 'MyApp',
        version: '1.5',
        config: {
          timeout: 30,
          retries: 3,
        },
      };
      fs.writeFileSync(testJsonPath, JSON.stringify(jsonData, null, 2), 'utf8');

      const result = await tool!.handler({
        jsonPath: testJsonPath,
        yamlPath: testYamlPath,
      });

      expect(result.content[0].text).toContain('JSON converted to YAML');
      expect(fs.existsSync(testYamlPath)).toBe(true);

      const yamlContent = fs.readFileSync(testYamlPath, 'utf8');
      expect(yamlContent).toContain('app: MyApp');
      expect(yamlContent).toContain("version: '1.5'");
      expect(yamlContent).toContain('timeout: 30');
    });

    it('should handle arrays in JSON', async () => {
      const tool = parserTools.find((t) => t.name === 'json_to_yaml');

      const jsonData = {
        items: ['item1', 'item2', 'item3'],
        users: [
          { name: 'John', age: 30 },
          { name: 'Jane', age: 25 },
        ],
      };
      fs.writeFileSync(testJsonPath, JSON.stringify(jsonData), 'utf8');

      await tool!.handler({
        jsonPath: testJsonPath,
        yamlPath: testYamlPath,
      });

      expect(fs.existsSync(testYamlPath)).toBe(true);

      const yamlContent = fs.readFileSync(testYamlPath, 'utf8');
      expect(yamlContent).toContain('items:');
      expect(yamlContent).toContain('- item1');
      expect(yamlContent).toContain('users:');
    });
  });

  describe('round-trip conversions', () => {
    it('should maintain data integrity through YAML->JSON->YAML', async () => {
      const yamlToJsonTool = parserTools.find((t) => t.name === 'yaml_to_json');
      const jsonToYamlTool = parserTools.find((t) => t.name === 'json_to_yaml');

      const originalYaml = `
app: TestApp
version: 1.0
features:
  - auth
  - api
  - admin
`;
      fs.writeFileSync(testYamlPath, originalYaml, 'utf8');

      // YAML -> JSON
      await yamlToJsonTool!.handler({
        yamlPath: testYamlPath,
        jsonPath: testJsonPath,
      });

      const testYamlPath2 = path.join('/tmp', 'test2.yaml');

      try {
        // JSON -> YAML
        await jsonToYamlTool!.handler({
          jsonPath: testJsonPath,
          yamlPath: testYamlPath2,
        });

        // Compare content
        const yaml1Content = fs.readFileSync(testYamlPath, 'utf8');
        const yaml2Content = fs.readFileSync(testYamlPath2, 'utf8');

        // Parse both to compare structure (formatting may differ)
        const data1 = yaml.load(yaml1Content);
        const data2 = yaml.load(yaml2Content);

        expect(data2).toEqual(data1);
      } finally {
        if (fs.existsSync(testYamlPath2)) {
          fs.unlinkSync(testYamlPath2);
        }
      }
    });
  });
});
