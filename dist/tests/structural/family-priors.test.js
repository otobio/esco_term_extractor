import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGenericHeadFamilyPriors } from '../../src/search-pipeline/generic-head-family-priors.js';
import { getJobFunctionFamilyPriors } from '../../src/search-pipeline/job-function-family-priors.js';
test('generic-head priors ignore inherited object property names', () => {
    assert.deepEqual(getGenericHeadFamilyPriors(['constructor'], ['constructor'], [], false), []);
    assert.deepEqual(getGenericHeadFamilyPriors(['toString'], ['toString'], [], false), []);
});
test('job-function priors ignore inherited object property names', () => {
    assert.deepEqual(getJobFunctionFamilyPriors('constructor'), []);
    assert.deepEqual(getJobFunctionFamilyPriors('toString'), []);
});
test('Romanian venue aliases drive generic-head priors to the right family buckets', () => {
    const retailManager = getGenericHeadFamilyPriors(['manager'], ['manager'], ['magazin'], false);
    const warehouseOperator = getGenericHeadFamilyPriors(['operator'], ['operator'], ['depozit'], false);
    const constructionSupervisor = getGenericHeadFamilyPriors(['sef'], ['sef'], ['santier'], false);
    const healthAssistant = getGenericHeadFamilyPriors(['asistent'], ['asistent'], ['spital'], false);
    assert.equal(retailManager[0]?.familyLabel, 'Retail and wholesale trade managers');
    assert.equal(warehouseOperator[0]?.familyLabel, 'Process control technicians');
    assert.equal(constructionSupervisor[0]?.familyLabel, 'Mining, manufacturing and construction supervisors');
    assert.equal(healthAssistant[0]?.familyLabel, 'Personal care workers in health services');
});
test('Hungarian venue aliases and generic heads resolve through the same family priors', () => {
    const hospitalityManager = getGenericHeadFamilyPriors(['menedzser'], ['menedzser'], ['etterem'], false);
    const industrialWorker = getGenericHeadFamilyPriors(['munkas'], ['munkas'], ['gyar'], false);
    const healthTechnician = getGenericHeadFamilyPriors(['technikus'], ['technikus'], ['korhaz'], false);
    const officeAssistant = getGenericHeadFamilyPriors(['asszisztens'], ['asszisztens'], ['iroda'], false);
    assert.equal(hospitalityManager[0]?.familyLabel, 'Hotel and restaurant managers');
    assert.equal(industrialWorker[0]?.familyLabel, 'Manufacturing labourers');
    assert.equal(healthTechnician[0]?.familyLabel, 'Medical and pharmaceutical technicians');
    assert.equal(officeAssistant[0]?.familyLabel, 'Administration professionals');
});
