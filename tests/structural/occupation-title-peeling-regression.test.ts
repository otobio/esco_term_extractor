import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanOccupationTitleSignals } from '../../src/query/occupation-signal-oov-cleaner.js';

const SOURCE = 'esco_1_2_1';

type CleanerExpectation = {
  title: string;
  locale: string;
  expectedCleanedTitle: string;
};

async function assertCleanerExpectation(expectation: CleanerExpectation): Promise<void> {
  const cleaned = await cleanOccupationTitleSignals({
    sourceName: SOURCE,
    locale: expectation.locale,
    title: expectation.title
  });

  assert.equal(cleaned, expectation.expectedCleanedTitle, `cleaned title mismatch for ${expectation.locale}: ${expectation.title}`);
}

test('simple OOV cleaner locks current token-only behavior for noisy titles', async () => {
  const cases: CleanerExpectation[] = [
    {
      title: 'Cautam colegi pentru Pizza Hut!',
      locale: 'ro',
      expectedCleanedTitle: 'pentru Pizza'
    },
    {
      title: 'Interfata terti si alte departamente , Alexandria',
      locale: 'ro',
      expectedCleanedTitle: 'Interfata si alte departamente'
    },
    {
      title: 'Project Manager Constructii (Regiune Vest - Transilvania)',
      locale: 'ro',
      expectedCleanedTitle: 'Project Manager Constructii'
    },
    {
      title: 'Consultant IT SAP IS-U(244347)',
      locale: 'ro',
      expectedCleanedTitle: 'Consultant IT SAP'
    },
    {
      title: 'Tehnician pe teren zona Harghita',
      locale: 'ro',
      expectedCleanedTitle: 'Tehnician pe teren zona'
    },
    {
      title: 'Specialist obtinere avize/autorizatii - Piatra Olt',
      locale: 'ro',
      expectedCleanedTitle: 'Specialist avize / autorizatii - Piatra'
    },
    {
      title: 'Sales Advisor Nespresso Boutique Afi Cotroceni 8h',
      locale: 'ro',
      expectedCleanedTitle: 'Sales Advisor Boutique'
    },
    {
      title: 'Sales Assistant - Tom Tailor - Afi Cotroceni',
      locale: 'ro',
      expectedCleanedTitle: 'Sales Assistant Tailor'
    }
  ];

  for (const testCase of cases) {
    await assertCleanerExpectation(testCase);
  }
});

test('simple OOV cleaner preserves structural separators only when both sides survive', async () => {
  assert.equal(
    await cleanOccupationTitleSignals({
      sourceName: SOURCE,
      locale: 'ro',
      title: 'Lucrator comercial / vanzator  mall - produse din inghetata'
    }),
    'Lucrator comercial / vanzator mall - produse din inghetata'
  );

  assert.equal(
    await cleanOccupationTitleSignals({
      sourceName: SOURCE,
      locale: 'ro',
      title: 'INGINER ELECTRONIST/ ELECTRONIST in  Cluj-Napoca'
    }),
    'INGINER ELECTRONIST / ELECTRONIST'
  );
});

test('simple OOV cleaner keeps joined tokens intact and allows split-part fallback', async () => {
  assert.equal(
    await cleanOccupationTitleSignals({
      sourceName: SOURCE,
      locale: 'ro',
      title: 'TEHNICIAN-ALPINIST TELECOMUNICATII'
    }),
    'TEHNICIAN-ALPINIST TELECOMUNICATII'
  );

  assert.equal(
    await cleanOccupationTitleSignals({
      sourceName: SOURCE,
      locale: 'ro',
      title: 'Consultant IT SAP IS-U(244347)'
    }),
    'Consultant IT SAP'
  );
});
