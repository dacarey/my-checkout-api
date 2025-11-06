import { ExampleOptions, ExampleResult } from '../types';
import { tokenCaptureExample } from './token-capture';

export type ExampleFunction = (options: ExampleOptions) => Promise<ExampleResult>;

export const examples: Record<string, ExampleFunction> = {
  'token-capture': tokenCaptureExample
};

export const exampleNames = Object.keys(examples);

export function getExample(name: string): ExampleFunction | undefined {
  return examples[name];
}

export function getAllExamples(): ExampleFunction[] {
  return Object.values(examples);
}
