import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifySpecializationQuery } from './specialization-dimension-mapper.js';
const inputPath = resolve(process.cwd(), 'data/runtime-review/occupation-leaf-structure.esco_1_2_1.json');
const artifact = JSON.parse(readFileSync(inputPath, 'utf8'));
const unresolvedByToken = new Map();
const examples = [];
let leavesWithConcepts = 0;
let leavesWithUnresolved = 0;
let totalConceptMatches = 0;
for (const leaf of artifact.records) {
    const result = classifySpecializationQuery(leaf.canonicalLabel);
    if (result.concepts.length > 0) {
        leavesWithConcepts += 1;
    }
    totalConceptMatches += result.concepts.length;
    if (result.unresolved.length === 0) {
        continue;
    }
    leavesWithUnresolved += 1;
    if (examples.length < 30) {
        examples.push(`${leaf.graphNodeId}\t${leaf.familyNodeId ?? ''}\t${leaf.canonicalLabel}\t${result.unresolved.join('|')}`);
    }
    for (const token of result.unresolved) {
        unresolvedByToken.set(token, (unresolvedByToken.get(token) ?? 0) + 1);
    }
}
console.log(JSON.stringify({
    leafCount: artifact.records.length,
    leavesWithConcepts,
    leavesWithUnresolved,
    totalConceptMatches,
    topUnresolvedTokens: [...unresolvedByToken.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 50)
        .map(([token, count]) => ({ token, count })),
    examples
}, null, 2));
