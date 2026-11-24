export interface AIProvider {
  createPrompt(itemA: string, itemB: string): string;
  generate(  itemA: string, itemB: string, existingListText: any, apiKey: string): Promise<string>;
}