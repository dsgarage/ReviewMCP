#!/usr/bin/env node

import { hybridCommands } from './dist/commands/hybrid-pipeline.js';
import { loadSecurityConfig } from './dist/config/security.js';

async function testBuild() {
  console.log('=== MCP Hybrid Pipeline Test Build ===\n');
  
  const cwd = process.cwd();
  
  // 1. セキュリティ設定の確認
  console.log('1. Loading security configuration...');
  const securityConfig = await loadSecurityConfig(cwd);
  console.log(`   Source: ${securityConfig.source}`);
  console.log(`   Max file size: ${securityConfig.maxFileSize} bytes`);
  console.log(`   Allowed extensions: ${securityConfig.allowedExtensions.join(', ')}\n`);
  
  // 2. Ruby拡張の確認
  console.log('2. Checking Ruby extensions...');
  const rubyCheck = await hybridCommands.checkRubyExtensions({ cwd });
  if (rubyCheck.success) {
    console.log('   Ruby extensions loaded successfully');
    if (rubyCheck.loadedExtensions && rubyCheck.loadedExtensions.length > 0) {
      console.log(`   Loaded: ${rubyCheck.loadedExtensions.join(', ')}`);
    }
  } else {
    console.log('   Warning: Ruby extensions not found (using standard Re:VIEW)');
  }
  console.log('');
  
  // 3. ハイブリッドPDFビルド
  console.log('3. Building PDF with hybrid pipeline...');
  console.log('   Running preprocessor...');
  console.log('   Building PDF with review-pdfmaker...\n');
  
  const buildResult = await hybridCommands.buildPdfHybrid({
    cwd,
    config: 'config.yml',
    skipPreprocess: false
  });
  
  if (buildResult.success) {
    console.log('✅ PDF build completed successfully!');
    
    if (buildResult.artifacts && buildResult.artifacts.length > 0) {
      console.log('\nGenerated files:');
      buildResult.artifacts.forEach(file => {
        console.log(`   - ${file}`);
      });
    }
    
    if (buildResult.results) {
      console.log('\nBuild steps:');
      buildResult.results.forEach(step => {
        const status = step.result.success ? '✓' : '✗';
        console.log(`   ${status} ${step.step}`);
      });
    }
  } else {
    console.log('❌ PDF build failed!');
    console.log(`   Error: ${buildResult.error}`);
    
    if (buildResult.results) {
      console.log('\nBuild steps:');
      buildResult.results.forEach(step => {
        const status = step.result.success ? '✓' : '✗';
        console.log(`   ${status} ${step.step}`);
        if (!step.result.success && step.result.error) {
          console.log(`      Error: ${step.result.error}`);
        }
      });
    }
    
    process.exit(1);
  }
}

// エラーハンドリング
process.on('unhandledRejection', (err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

// 実行
testBuild().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});