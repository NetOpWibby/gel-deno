
import { $, adapter, type Client } from "../mod.ts";
import { DirBuilder } from "./builders.ts";
import { generateInterfaces } from "./edgeql-js/generateInterfaces.ts";
import { headerComment } from "./genutil.ts";
import type { CommandOptions } from "./commandutil.ts";

const { path } = adapter;



export async function runInterfacesGenerator(params: { client: Client; options: CommandOptions; root: string | null; schemaDir: string; }) {
  const { client, options, root, schemaDir } = params;
  let outFile: string;

  if (options.file) {
    outFile = path.isAbsolute(options.file) ?
      options.file :
      path.join(adapter.process.cwd(), options.file);
  } else if (root) {
    outFile = path.join(root, schemaDir, "interfaces.ts");
  } else {
    throw new Error(
      "No project config file found. Initialize a Gel project with\n" +
      "'gel project init' or specify an output file with '--file'",
    );
  }

  let outputDirIsInProject = false;
  let prettyOutputDir;

  if (root) {
    const relativeOutputDir = path.posix.relative(root, outFile);
    outputDirIsInProject = !relativeOutputDir.startsWith("..");
    prettyOutputDir = outputDirIsInProject ? `./${relativeOutputDir}` : outFile;
  } else {
    prettyOutputDir = outFile;
  }

  const dir = new DirBuilder();
  console.log(`Introspecting database schema…`);
  const types = await $.introspect.types(client);

  const generatorParams = { dir, types };
  console.log(`Generating interfaces…`);
  generateInterfaces(generatorParams);

  const file = dir.getPath("interfaces");

  const rendered =
    headerComment +
    file.render({
      mode: "ts",
      moduleExtension: "",
      moduleKind: "esm"
    });

  console.log(`Writing interfaces file…`);
  console.log("   " + prettyOutputDir);
  await adapter.fs.writeFile(outFile, rendered);
  console.log(`Generation complete! 🤘`);
}
