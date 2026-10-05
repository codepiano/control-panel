(function (target) {
  function buildProjectTree(projects, collections = [], selectedKeys = null) {
    const selected = selectedKeys === null ? null : new Set(selectedKeys);
    const nodes = new Map();
    const ensure = (item) => {
      if (!nodes.has(item.key)) nodes.set(item.key, { key: item.key, name: item.name, project: null, collection: null, parentKey: null, children: [] });
      return nodes.get(item.key);
    };
    for (const project of projects) ensure(project).project = project;
    for (const collection of collections) ensure(collection).collection = collection;
    for (const item of [...collections, ...projects]) {
      let parent = null;
      for (const ancestor of item.ancestors || []) {
        const node = ensure(ancestor);
        if (parent && !node.parentKey) node.parentKey = parent.key;
        parent = node;
      }
      if (parent) ensure(item).parentKey = parent.key;
    }
    const roots = [];
    for (const node of nodes.values()) {
      const parent = nodes.get(node.parentKey);
      if (parent) parent.children.push(node); else roots.push(node);
    }
    const prune = (node) => {
      const children = node.children.map(prune).filter(Boolean);
      const matches = Boolean(node.project && (!selected || selected.has(node.key)));
      if (selected && !matches && !children.length) return null;
      return { ...node, matches, children };
    };
    return roots.map(prune).filter(Boolean);
  }
  function matchingProjects(node) {
    return [...(node.matches && node.project ? [node.project] : []), ...node.children.flatMap(matchingProjects)];
  }
  const api = { buildProjectTree, matchingProjects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else target.projectTree = api;
})(typeof window === 'undefined' ? globalThis : window);
