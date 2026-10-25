export {};
declare global {
  interface Window {
    controlPanel: Record<string, (...args: any[]) => Promise<any>>;
    projectTree: {
      buildProjectTree: (
        projects: any[],
        collections?: any[],
        selectedKeys?: string[] | null,
      ) => any[];
      matchingProjects: (node: any) => any[];
    };
  }
}
