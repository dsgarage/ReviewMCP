import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runCommand } from "../utils/runCommand.js";

const execp = promisify(execFile);

export interface PreprocessOptions {
  pattern?: string;
  output?: string;
  stats?: boolean;
  cwd: string;
}

export interface BuildPdfOptions {
  config?: string;
  skipPreprocess?: boolean;
  cwd: string;
}

export interface TestMapfileOptions {
  file: string;
  cwd: string;
}

export async function preprocessCommand(options: PreprocessOptions) {
  const {
    pattern = "articles/**/*.re",
    output = ".out",
    stats = true,
    cwd
  } = options;

  const args = [
    "packages/review-macro-shims/bin/review-preprocess.js",
    pattern,
    "-o", output
  ];
  
  if (stats) {
    args.push("--stats");
  }

  try {
    const result = await runCommand("node", args, { cwd });
    return {
      success: true,
      output: result.stdout,
      stats: stats ? parsePreprocessStats(result.stdout) : null
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr
    };
  }
}

export async function buildPdfHybridCommand(options: BuildPdfOptions) {
  const {
    config = "config.yml",
    skipPreprocess = false,
    cwd
  } = options;

  const results: any[] = [];

  if (!skipPreprocess) {
    console.log("[build-pdf-hybrid] Running preprocessor...");
    const preprocessResult = await preprocessCommand({ cwd });
    results.push({ step: "preprocess", result: preprocessResult });
    
    if (!preprocessResult.success) {
      return {
        success: false,
        error: "Preprocessing failed",
        results
      };
    }
  }

  console.log("[build-pdf-hybrid] Building PDF with review-pdfmaker...");
  try {
    const pdfResult = await runCommand("review-pdfmaker", ["-c", config], { 
      cwd,
      useBundle: true 
    });
    
    results.push({ step: "pdf-build", result: { 
      success: true, 
      output: pdfResult.stdout 
    }});

    const pdfFiles = await findGeneratedPdf(cwd);
    
    return {
      success: true,
      results,
      artifacts: pdfFiles
    };
  } catch (error: any) {
    results.push({ step: "pdf-build", result: { 
      success: false, 
      error: error.message,
      stderr: error.stderr 
    }});
    
    return {
      success: false,
      error: "PDF build failed",
      results
    };
  }
}

export async function checkRubyExtensionsCommand(options: { cwd: string }) {
  const { cwd } = options;

  try {
    const result = await runCommand("ruby", [
      "-r", "./review-ext.rb",
      "-e", "puts 'Extensions loaded: ' + $LOADED_FEATURES.grep(/review/).join(', ')"
    ], { 
      cwd, 
      env: { ...process.env, DEBUG: "1" }
    });

    const extensionsLoaded = result.stdout.includes("Extensions loaded");
    const loadedFiles = result.stdout.match(/Extensions loaded: (.+)/)?.[1] || "";

    return {
      success: extensionsLoaded,
      loadedExtensions: loadedFiles.split(", ").filter(Boolean),
      output: result.stdout
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr
    };
  }
}

export async function testMapfileCommand(options: TestMapfileOptions) {
  const { file, cwd } = options;

  const testFile = path.join(cwd, "test-mapfile.re");
  const testContent = `//list[test]{
#@mapfile(${file})
#@end
//}
`;

  try {
    await fs.writeFile(testFile, testContent, "utf-8");
    
    const result = await preprocessCommand({
      pattern: "test-mapfile.re",
      output: ".out",
      stats: true,
      cwd
    });

    await fs.unlink(testFile).catch(() => {});

    if (result.success) {
      const outputFile = path.join(cwd, ".out", "test-mapfile.re");
      const processedContent = await fs.readFile(outputFile, "utf-8").catch(() => "");
      
      return {
        success: true,
        processedContent,
        stats: result.stats
      };
    }

    return result;
  } catch (error: any) {
    await fs.unlink(testFile).catch(() => {});
    return {
      success: false,
      error: error.message
    };
  }
}

function parsePreprocessStats(output: string): any {
  const stats: any = {
    filesProcessed: 0,
    macrosExpanded: 0,
    warnings: []
  };

  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes("Files processed:")) {
      stats.filesProcessed = parseInt(line.match(/\d+/)?.[0] || "0");
    }
    if (line.includes("Macros expanded:")) {
      stats.macrosExpanded = parseInt(line.match(/\d+/)?.[0] || "0");
    }
    if (line.includes("Warning:")) {
      stats.warnings.push(line);
    }
  }

  return stats;
}

async function findGeneratedPdf(cwd: string): Promise<string[]> {
  try {
    const files = await fs.readdir(cwd);
    const pdfFiles = files.filter(f => f.endsWith(".pdf"));
    return pdfFiles.map(f => path.join(cwd, f));
  } catch {
    return [];
  }
}

export const hybridCommands = {
  preprocess: preprocessCommand,
  buildPdfHybrid: buildPdfHybridCommand,
  checkRubyExtensions: checkRubyExtensionsCommand,
  testMapfile: testMapfileCommand
};