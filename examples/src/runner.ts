#!/usr/bin/env node

import chalk from 'chalk';
import { getConfig, validateConfig, parseCliArgs, printUsage, getCybersourceCredentials, validateCybersourceCredentials } from './config';
import { exampleNames, getExample, getAllExamples } from './examples';
import { ExampleResult, ExampleOptions } from './types';

async function runExample(name: string, options: ExampleOptions): Promise<ExampleResult> {
  const example = getExample(name);
  if (!example) {
    throw new Error(`Unknown example: ${name}`);
  }

  console.log(chalk.blue(`\n=== Running ${name} Example ===`));
  console.log(chalk.yellow(`Endpoint: ${options.config.baseUrl}`));
  console.log(chalk.yellow(`Brand: ${options.config.brandKey}`));

  const result = await example(options);
  return result;
}

function displayResult(result: ExampleResult): void {
  const { name, endpoint, success, statusCode, response, error, duration, request, headers } = result;

  console.log(chalk.blue(`\n${name} Result:`));
  console.log(chalk.yellow(`${endpoint}`));

  if (success) {
    console.log(chalk.green(`✅ SUCCESS (HTTP ${statusCode}) - ${duration}ms`));
    console.log(chalk.green('Response:'));
    if (response) {
      try {
        console.log(JSON.stringify(response, null, 2));
      } catch (e) {
        console.log(response);
      }
    }
  } else {
    console.log(chalk.red(`❌ FAILED (HTTP ${statusCode}) - ${duration}ms`));
    if (error) {
      console.log(chalk.red('Error:'));
      console.log(error);
    }
    if (request) {
      console.log(chalk.red('Request:'));
      try {
        console.log(JSON.stringify(request, null, 2));
      } catch (e) {
        console.log(request);
      }
    }
    if (headers) {
      console.log(chalk.red('Headers:'));
      try {
        console.log(JSON.stringify(headers, null, 2));
      } catch (e) {
        console.log(headers);
      }
    }
    if (response) {
      console.log(chalk.red('Response:'));
      try {
        console.log(JSON.stringify(response, null, 2));
      } catch (e) {
        console.log(response);
      }
    }
  }

  console.log('\n' + '---'.repeat(20));
}

function displaySummary(results: ExampleResult[]): void {
  console.log(chalk.blue('\n=== Test Summary ==='));

  const successful = results.filter(r => r.success).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  results.forEach(result => {
    const status = result.success ? chalk.green('✅') : chalk.red('❌');
    const duration = chalk.gray(`${result.duration}ms`);
    console.log(`${status} ${result.name} (HTTP ${result.statusCode}) ${duration}`);
  });

  console.log(chalk.blue(`\nResults: ${successful}/${total} passed`));
  console.log(chalk.yellow(`Total time: ${totalDuration}ms`));

  if (successful === total) {
    console.log(chalk.green('\n🎉 All examples completed successfully!'));
  } else {
    console.log(chalk.red(`\n❌ ${total - successful} example(s) failed`));
  }
}

async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = parseCliArgs(args);

    // Load and validate configuration
    const config = getConfig(options);
    validateConfig(config);

    console.log(chalk.blue('=== Checkout API Examples ==='));
    console.log(chalk.yellow(`API ID: ${config.apiId}`));
    console.log(chalk.yellow(`Base URL: ${config.baseUrl}`));
    console.log(chalk.yellow(`Brand: ${config.brandKey}`));
    console.log(chalk.yellow(`Region: ${config.region}`));

    // Check Cybersource credentials for token generation
    const credentials = getCybersourceCredentials();
    validateCybersourceCredentials(credentials);

    if (config.lockData) {
      console.log(chalk.gray(`Using deployment lock file (deployed at ${config.lockData.timestamp})`));
    }

    const exampleOptions: ExampleOptions = {
      config,
      verbose: options.verbose,
      timeout: options.timeout
    };

    let results: ExampleResult[] = [];

    // Run specific example or all examples
    if (options.example) {
      console.log(chalk.blue(`\nRunning specific example: ${options.example}`));
      const result = await runExample(options.example, exampleOptions);
      results.push(result);
      displayResult(result);
    } else {
      console.log(chalk.blue(`\nRunning all ${exampleNames.length} examples...\n`));
      for (const name of exampleNames) {
        const result = await runExample(name, exampleOptions);
        results.push(result);
        displayResult(result);
      }
    }

    // Display summary
    if (results.length > 1) {
      displaySummary(results);
    }

    // Exit with appropriate code
    const allSuccess = results.every(r => r.success);
    process.exit(allSuccess ? 0 : 1);

  } catch (error) {
    console.error(chalk.red('\n❌ Error:'));
    console.error(error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.message.includes('API ID is required')) {
      console.log(chalk.yellow('\nHint: Run with --help for usage information'));
    }

    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
