// src/workers/inference.worker.js

self.onmessage = function (event) {
  try {
    const request = event.data;
    if (!request || typeof request.type !== 'string') {
      throw new Error('Malformed worker request payload.');
    }

    const { type, payload } = request;

    if (type === 'RUN_INFERENCE') {
      // Intentionally simulate a crash if requested for verification testing
      if (payload && payload.queryString === 'FORCE_CRASH') {
        throw new Error('Simulated worker execution failure.');
      }

      const scenario = (payload && payload.scenario) || 'SCENARIO_A';

      let extractionData = {
        extractedTokens: ['Augmentin 625mg', 'BD'],
        confidence: 0.94
      };

      let validationData = {
        genericId: 'AMX-CLV-625',
        genericName: 'Amoxicillin/Clavulanate',
        localBrand: 'Augmentin',
        dailyDoseMg: 1250,
        nstgMaxDailyDoseMg: 2000,
        requiresPregnancyCheck: 0
      };

      let completeData = {
        verdict: 'PASS',
        message: 'Dosage Matches NSTG Guidelines. No Known Interactions.',
        citation: 'NSTG Section 3.1, Page 45'
      };

      if (scenario === 'SCENARIO_B') {
        extractionData = {
          extractedTokens: ['Methotrexate 7.5mg', 'Daily'],
          confidence: 0.96
        };
        validationData = {
          genericId: 'MTX-7.5',
          genericName: 'Methotrexate',
          localBrand: 'Methotrexate',
          dailyDoseMg: 7.5,
          nstgMaxDailyDoseMg: 15.0,
          requiresPregnancyCheck: 1
        };
        completeData = {
          verdict: 'WARNING',
          message: 'Active contraindication: pregnancy check required. Moderate renal impairment override detected.',
          citation: 'NSTG Chapter 4, Page 88'
        };
      } else if (scenario === 'SCENARIO_C') {
        extractionData = {
          extractedTokens: ['Clarithromycin 500mg', 'Simvastatin 40mg'],
          confidence: 0.98
        };
        validationData = {
          genericId: 'CLA-SIM-999',
          genericName: 'Clarithromycin + Simvastatin',
          localBrand: 'Clarithromycin/Simvastatin',
          dailyDoseMg: 540,
          nstgMaxDailyDoseMg: 0,
          requiresPregnancyCheck: 0
        };
        completeData = {
          verdict: 'DANGER',
          message: 'Lethal drug interaction: Clarithromycin co-administration contraindicated with Simvastatin due to severe risk of rhabdomyolysis.',
          citation: 'NSTG Chapter 7, Page 143'
        };
      }

      // Step 1: EXTRACTION
      self.postMessage({
        status: 'SUCCESS',
        step: 'EXTRACTION',
        data: extractionData
      });

      // Simulate a short processing delay to demonstrate progressive rendering
      setTimeout(() => {
        // Step 2: VALIDATION
        self.postMessage({
          status: 'SUCCESS',
          step: 'VALIDATION',
          data: validationData
        });

        setTimeout(() => {
          // Step 3: COMPLETE
          self.postMessage({
            status: 'SUCCESS',
            step: 'COMPLETE',
            data: completeData
          });
        }, 150);
      }, 150);

    } else if (type === 'QUERY_DATABASE') {
      self.postMessage({
        status: 'SUCCESS',
        step: 'COMPLETE',
        data: {
          rows: [
            { id: 1, brand_name: 'Augmentin', generic_name: 'Amoxicillin/Clavulanate' }
          ]
        }
      });
    } else if (type === 'RESET_PIPELINE') {
      self.postMessage({
        status: 'SUCCESS',
        step: 'COMPLETE',
        data: {
          reset: true
        }
      });
    } else {
      throw new Error(`Unknown request type: ${type}`);
    }

  } catch (error) {
    self.postMessage({
      status: 'ERROR',
      step: 'COMPLETE',
      data: null,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
