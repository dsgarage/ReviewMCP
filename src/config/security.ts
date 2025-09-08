import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";

const execp = promisify(execFile);

export interface SecurityConfig {
  maxFileSize: number;
  allowedExtensions: string[];
  allowedPaths: string[];
  blockAbsolutePaths: boolean;
  blockTraversal: boolean;
  source: "reviewextention" | "local" | "default";
  timestamp: string;
}

const DEFAULT_SECURITY: SecurityConfig = {
  maxFileSize: 1024 * 1024,
  allowedExtensions: [".txt", ".re", ".rb", ".cs", ".java", ".py", ".js", ".ts"],
  allowedPaths: ["code/", "src/", "lib/", "examples/"],
  blockAbsolutePaths: true,
  blockTraversal: true,
  source: "default",
  timestamp: new Date().toISOString()
};

let cachedConfig: SecurityConfig | null = null;
let cacheExpiry: number = 0;

export async function loadSecurityConfig(cwd: string, forceReload = false): Promise<SecurityConfig> {
  const now = Date.now();
  
  if (!forceReload && cachedConfig && now < cacheExpiry) {
    console.log("[Security] Using cached SSOT config");
    return cachedConfig;
  }

  console.log("[Security] Loading SSOT configuration...");

  try {
    const reviewExtConfig = await loadFromReviewExtention(cwd);
    if (reviewExtConfig) {
      cachedConfig = reviewExtConfig;
      cacheExpiry = now + 5 * 60 * 1000;
      logConfigSource(reviewExtConfig);
      return reviewExtConfig;
    }
  } catch (error) {
    console.warn("[Security] Failed to load from ReviewExtention:", error);
  }

  try {
    const localConfig = await loadFromLocalConfig(cwd);
    if (localConfig) {
      cachedConfig = localConfig;
      cacheExpiry = now + 5 * 60 * 1000;
      logConfigSource(localConfig);
      return localConfig;
    }
  } catch (error) {
    console.warn("[Security] Failed to load local config:", error);
  }

  console.log("[Security] Using default configuration");
  cachedConfig = DEFAULT_SECURITY;
  cacheExpiry = now + 5 * 60 * 1000;
  logConfigSource(DEFAULT_SECURITY);
  return DEFAULT_SECURITY;
}

async function loadFromReviewExtention(cwd: string): Promise<SecurityConfig | null> {
  try {
    const rubyScript = `
      begin
        require_relative './review-ext.rb'
        require 'json'
        
        config = {
          max_file_size: defined?(MAX_FILE_SIZE) ? MAX_FILE_SIZE : 1048576,
          allowed_extensions: defined?(ALLOWED_EXTENSIONS) ? ALLOWED_EXTENSIONS : [],
          allowed_paths: defined?(ALLOWED_PATHS) ? ALLOWED_PATHS : [],
          block_absolute_paths: defined?(BLOCK_ABSOLUTE_PATHS) ? BLOCK_ABSOLUTE_PATHS : true,
          block_traversal: defined?(BLOCK_TRAVERSAL) ? BLOCK_TRAVERSAL : true
        }
        
        puts JSON.generate(config)
      rescue LoadError => e
        exit 1
      end
    `;

    const result = await execp("ruby", ["-e", rubyScript], {
      cwd,
      timeout: 5000
    });

    const parsed = JSON.parse(result.stdout);
    
    return {
      maxFileSize: parsed.max_file_size,
      allowedExtensions: parsed.allowed_extensions,
      allowedPaths: parsed.allowed_paths,
      blockAbsolutePaths: parsed.block_absolute_paths,
      blockTraversal: parsed.block_traversal,
      source: "reviewextention",
      timestamp: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

async function loadFromLocalConfig(cwd: string): Promise<SecurityConfig | null> {
  const configPaths = [
    path.join(cwd, "config", "security.yml"),
    path.join(cwd, "config", "security.yaml"),
    path.join(cwd, "security.yml"),
    path.join(cwd, ".review-security.yml")
  ];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = YAML.parse(content);
      
      if (parsed.security) {
        return {
          maxFileSize: parsed.security.max_file_size || DEFAULT_SECURITY.maxFileSize,
          allowedExtensions: parsed.security.allowed_extensions || DEFAULT_SECURITY.allowedExtensions,
          allowedPaths: parsed.security.allowed_paths || DEFAULT_SECURITY.allowedPaths,
          blockAbsolutePaths: parsed.security.block_absolute_paths ?? DEFAULT_SECURITY.blockAbsolutePaths,
          blockTraversal: parsed.security.block_traversal ?? DEFAULT_SECURITY.blockTraversal,
          source: "local",
          timestamp: new Date().toISOString()
        };
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

export function validateMapfilePath(
  filepath: string,
  config: SecurityConfig
): { valid: boolean; reason?: string } {
  
  if (config.blockAbsolutePaths && path.isAbsolute(filepath)) {
    return { valid: false, reason: "Absolute paths are not allowed" };
  }

  if (config.blockTraversal && (filepath.includes("../") || filepath.includes("..\\"))) {
    return { valid: false, reason: "Path traversal is not allowed" };
  }

  const ext = path.extname(filepath).toLowerCase();
  if (config.allowedExtensions.length > 0 && !config.allowedExtensions.includes(ext)) {
    return { 
      valid: false, 
      reason: `File extension '${ext}' is not allowed. Allowed: ${config.allowedExtensions.join(", ")}` 
    };
  }

  const normalizedPath = filepath.replace(/\\/g, "/");
  const isInAllowedPath = config.allowedPaths.length === 0 || 
    config.allowedPaths.some(allowed => normalizedPath.startsWith(allowed));
  
  if (!isInAllowedPath) {
    return { 
      valid: false, 
      reason: `Path must be within allowed directories: ${config.allowedPaths.join(", ")}` 
    };
  }

  return { valid: true };
}

export async function validateMapfileSize(
  filepath: string,
  cwd: string,
  config: SecurityConfig
): Promise<{ valid: boolean; reason?: string; size?: number }> {
  
  const fullPath = path.join(cwd, filepath);
  
  try {
    const stats = await fs.stat(fullPath);
    
    if (stats.size > config.maxFileSize) {
      return {
        valid: false,
        reason: `File size (${stats.size} bytes) exceeds maximum allowed size (${config.maxFileSize} bytes)`,
        size: stats.size
      };
    }
    
    return { valid: true, size: stats.size };
  } catch (error: any) {
    return {
      valid: false,
      reason: `Cannot access file: ${error.message}`
    };
  }
}

export async function sanitizeMapfile(
  content: string,
  filepath: string,
  config: SecurityConfig
): Promise<{ safe: boolean; sanitized?: string; issues: string[] }> {
  
  const issues: string[] = [];
  
  const suspiciousPatterns = [
    /eval\s*\(/gi,
    /require\s*\(/gi,
    /import\s+/gi,
    /__import__/gi,
    /exec\s*\(/gi,
    /system\s*\(/gi,
    /`[^`]*`/g
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(content)) {
      issues.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }
  
  if (issues.length > 0) {
    return { safe: false, issues };
  }
  
  return { safe: true, sanitized: content, issues: [] };
}

function logConfigSource(config: SecurityConfig) {
  console.log(`[Security] Configuration loaded from: ${config.source}`);
  console.log(`[Security] Max file size: ${config.maxFileSize} bytes`);
  console.log(`[Security] Allowed extensions: ${config.allowedExtensions.join(", ")}`);
  console.log(`[Security] Allowed paths: ${config.allowedPaths.join(", ")}`);
  console.log(`[Security] Block absolute paths: ${config.blockAbsolutePaths}`);
  console.log(`[Security] Block traversal: ${config.blockTraversal}`);
}

export async function compareWithReviewExtention(
  cwd: string,
  currentConfig: SecurityConfig
): Promise<{ matching: boolean; differences: string[] }> {
  
  const reviewExtConfig = await loadFromReviewExtention(cwd);
  
  if (!reviewExtConfig) {
    return { matching: false, differences: ["ReviewExtention config not available"] };
  }
  
  const differences: string[] = [];
  
  if (currentConfig.maxFileSize !== reviewExtConfig.maxFileSize) {
    differences.push(`Max file size: MCP=${currentConfig.maxFileSize}, ReviewExt=${reviewExtConfig.maxFileSize}`);
  }
  
  const extDiff = arrayDifference(currentConfig.allowedExtensions, reviewExtConfig.allowedExtensions);
  if (extDiff.length > 0) {
    differences.push(`Allowed extensions differ: ${extDiff.join(", ")}`);
  }
  
  const pathDiff = arrayDifference(currentConfig.allowedPaths, reviewExtConfig.allowedPaths);
  if (pathDiff.length > 0) {
    differences.push(`Allowed paths differ: ${pathDiff.join(", ")}`);
  }
  
  return {
    matching: differences.length === 0,
    differences
  };
}

function arrayDifference(arr1: string[], arr2: string[]): string[] {
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  const diff: string[] = [];
  
  for (const item of set1) {
    if (!set2.has(item)) diff.push(`+${item}`);
  }
  for (const item of set2) {
    if (!set1.has(item)) diff.push(`-${item}`);
  }
  
  return diff;
}