import $RefParser from "@apidevtools/json-schema-ref-parser";
import $jsonSchemaToZod from "json-schema-to-zod";
import { argv, exit } from 'node:process';
import { writeFile } from 'node:fs/promises';

const url = argv[2];
const className = argv[3];
const outputFile = argv[4];

if (!url || !className || !outputFile) {
  console.error("Error: Please provide a URL, class name, and output file as command-line arguments.");
  console.error("Usage: node make_zod_type.mjs <url> <className>");
  exit(1);
}

console.log(`Generating Zod type for ${className} from ${url} to ${outputFile}`);

try {
  const schema = await $RefParser.dereference(url);
  const zod = $jsonSchemaToZod(schema, {
    module: "esm",
    name: className,
    type: className,
    withJsdocs: true,
    zodVersion: 4,
  });
  await writeFile(outputFile, zod);
} catch (err) {
  console.error("Error:", err);
  exit(1);
}
