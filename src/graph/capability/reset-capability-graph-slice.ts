import type { Connection } from 'mysql2/promise';

export async function resetCapabilityGraphSlice(connection: Connection, sourceName: string): Promise<void> {
  const capabilityKeyPrefix = `${sourceName}:capability:`;

  await connection.execute(
    `
      DELETE link
      FROM ose_graph_capability_links link
      INNER JOIN ose_capabilities capability
        ON capability.id = link.capability_id
      WHERE capability.canonical_key LIKE ?
    `,
    [`${capabilityKeyPrefix}%`]
  );

  await connection.execute(
    `
      DELETE FROM ose_capabilities
      WHERE canonical_key LIKE ?
    `,
    [`${capabilityKeyPrefix}%`]
  );
}
