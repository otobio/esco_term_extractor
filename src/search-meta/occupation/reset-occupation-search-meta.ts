import type { Connection } from 'mysql2/promise';

export async function resetOccupationSearchMeta(connection: Connection, sourceName: string): Promise<void> {
  await connection.execute(
    `
      DELETE hint
      FROM ose_search_meta_capability_hints hint
      INNER JOIN ose_search_meta meta
        ON meta.id = hint.search_meta_id
      INNER JOIN ose_graph_node_sources node_source
        ON node_source.graph_node_id = meta.graph_node_id
      WHERE node_source.source_name = ?
    `,
    [sourceName]
  );

  await connection.execute(
    `
      DELETE sibling
      FROM ose_search_meta_siblings sibling
      INNER JOIN ose_search_meta meta
        ON meta.id = sibling.search_meta_id
      INNER JOIN ose_graph_node_sources node_source
        ON node_source.graph_node_id = meta.graph_node_id
      WHERE node_source.source_name = ?
    `,
    [sourceName]
  );

  await connection.execute(
    `
      DELETE ancestor
      FROM ose_search_meta_ancestors ancestor
      INNER JOIN ose_search_meta meta
        ON meta.id = ancestor.search_meta_id
      INNER JOIN ose_graph_node_sources node_source
        ON node_source.graph_node_id = meta.graph_node_id
      WHERE node_source.source_name = ?
    `,
    [sourceName]
  );

  await connection.execute(
    `
      DELETE alias
      FROM ose_search_meta_aliases alias
      INNER JOIN ose_search_meta meta
        ON meta.id = alias.search_meta_id
      INNER JOIN ose_graph_node_sources node_source
        ON node_source.graph_node_id = meta.graph_node_id
      WHERE node_source.source_name = ?
    `,
    [sourceName]
  );

  await connection.execute(
    `
      DELETE meta
      FROM ose_search_meta meta
      INNER JOIN ose_graph_node_sources node_source
        ON node_source.graph_node_id = meta.graph_node_id
      WHERE node_source.source_name = ?
    `,
    [sourceName]
  );
}
