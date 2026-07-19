export class Octokit {
  static lastOptions: Record<string, unknown> | undefined;
  constructor(options?: Record<string, unknown>) { Octokit.lastOptions = options; }
  request = jest.fn();
}
