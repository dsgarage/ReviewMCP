import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execp = promisify(execFile);

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
  useBundle?: boolean;
  saveArtifacts?: boolean;
  artifactsDir?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  artifactPath?: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions
): Promise<CommandResult> {
  const {
    cwd,
    env = process.env,
    timeout = 60000,
    maxBuffer = 10 * 1024 * 1024,
    useBundle = false,
    saveArtifacts = false,
    artifactsDir = path.join(cwd, ".artifacts")
  } = options;

  const startTime = Date.now();
  
  let finalCommand = command;
  let finalArgs = args;

  if (useBundle && await hasBundler(cwd)) {
    finalCommand = "bundle";
    finalArgs = ["exec", command, ...args];
  }

  try {
    const result = await execp(finalCommand, finalArgs, {
      cwd,
      env,
      timeout,
      maxBuffer
    });

    const duration = Date.now() - startTime;
    const commandResult: CommandResult = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      duration
    };

    if (saveArtifacts) {
      commandResult.artifactPath = await saveCommandArtifacts(
        artifactsDir,
        command,
        commandResult
      );
    }

    logCommand(command, args, commandResult);
    return commandResult;

  } catch (error: any) {
    const duration = Date.now() - startTime;
    const commandResult: CommandResult = {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      duration
    };

    if (saveArtifacts) {
      commandResult.artifactPath = await saveCommandArtifacts(
        artifactsDir,
        command,
        commandResult
      );
    }

    logCommand(command, args, commandResult, true);
    throw error;
  }
}

export async function runCommandStreaming(
  command: string,
  args: string[],
  options: RunCommandOptions,
  onStdout?: (data: string) => void,
  onStderr?: (data: string) => void
): Promise<CommandResult> {
  const {
    cwd,
    env = process.env,
    timeout = 60000,
    useBundle = false
  } = options;

  const startTime = Date.now();
  
  let finalCommand = command;
  let finalArgs = args;

  if (useBundle && await hasBundler(cwd)) {
    finalCommand = "bundle";
    finalArgs = ["exec", command, ...args];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(finalCommand, finalArgs, {
      cwd,
      env,
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data) => {
      const str = data.toString();
      stdout += str;
      if (onStdout) onStdout(str);
    });

    child.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      if (onStderr) onStderr(str);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout}ms`));
        return;
      }

      const result: CommandResult = {
        stdout,
        stderr,
        exitCode: code || 0,
        duration
      };

      if (code === 0) {
        resolve(result);
      } else {
        const error: any = new Error(`Command failed with exit code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
  });
}

async function hasBundler(cwd: string): Promise<boolean> {
  try {
    await execp("bundle", ["--version"], { cwd, timeout: 5000 });
    const gemfilePath = path.join(cwd, "Gemfile");
    await fs.access(gemfilePath);
    return true;
  } catch {
    return false;
  }
}

async function saveCommandArtifacts(
  artifactsDir: string,
  command: string,
  result: CommandResult
): Promise<string> {
  await fs.mkdir(artifactsDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeCommand = command.replace(/[^a-z0-9]/gi, "-");
  const filename = `${safeCommand}-${timestamp}.json`;
  const filepath = path.join(artifactsDir, filename);

  const artifact = {
    command,
    timestamp: new Date().toISOString(),
    duration: result.duration,
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 100000),
    stderr: result.stderr.slice(0, 100000)
  };

  await fs.writeFile(filepath, JSON.stringify(artifact, null, 2), "utf-8");
  return filepath;
}

function logCommand(
  command: string,
  args: string[],
  result: CommandResult,
  isError: boolean = false
) {
  const prefix = isError ? "[ERROR]" : "[OK]";
  const commandLine = `${command} ${args.join(" ")}`;
  
  console.log(`${prefix} ${commandLine} (${result.duration}ms)`);
  
  if (isError && result.stderr) {
    console.error("STDERR:", result.stderr.slice(0, 500));
  }
}