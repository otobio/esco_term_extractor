export async function resetGraphBucket(connection, bucket) {
    await connection.execute(`
      DELETE relationship
      FROM ose_graph_relationships relationship
      LEFT JOIN ose_graph_nodes parent_node
        ON parent_node.id = relationship.parent_node_id
      LEFT JOIN ose_graph_nodes child_node
        ON child_node.id = relationship.child_node_id
      WHERE parent_node.bucket = ?
         OR child_node.bucket = ?
    `, [bucket, bucket]);
    await connection.execute(`
      DELETE alias
      FROM ose_graph_aliases alias
      INNER JOIN ose_graph_nodes node
        ON node.id = alias.graph_node_id
      WHERE node.bucket = ?
    `, [bucket]);
    await connection.execute(`
      DELETE node_source
      FROM ose_graph_node_sources node_source
      INNER JOIN ose_graph_nodes node
        ON node.id = node_source.graph_node_id
      WHERE node.bucket = ?
    `, [bucket]);
    await connection.execute(`
      DELETE FROM ose_graph_nodes
      WHERE bucket = ?
    `, [bucket]);
}
