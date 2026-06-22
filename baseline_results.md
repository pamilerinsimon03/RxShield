# OCR Batch Evaluation Report

**Timestamp:** 2026-06-22T18:24:33.956Z
**Overall Accuracy:** 17/18 (94.44%)

## Detailed Results Matrix

| File Name / Ground Truth | Raw OCR Decoded | Post-Processed / DB Verified | DB Match | Safety Verdict | Status |
| --- | --- | --- | --- | --- | --- |
| `Amoxil 2gm Daily` | `Amoxil 2gm Daily` | `AMOXIL 2gm Daily` | `AMOXIL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Amoxil 500mg TDS` | `Amoxil 500mg TDS` | `AMOXIL 500mg TDS` | `AMOXIL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Amoxil 500mg` | `Amoxil 500mg` | `AMOXIL 500mg` | `AMOXIL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Anugmontin 625` | `Anugmontin 625 ` | `AUGMENTIN 625` | `AUGMENTIN` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Azathioprine 50mg Daily` | `Azathioprine 50mg Daily` | `AZATHIOPRINE 50mg Daily` | `AZATHIOPRINE` | **DANGER**: *Daily dose (50mg) exceeds maximum guideline limit (3mg) for AZATHIOPRINE.* | ✅ SUCCESS |
| `Azathioprine 50mg` | `Azathioprine 50mg` | `AZATHIOPRINE 50mg` | `AZATHIOPRINE` | **DANGER**: *Daily dose (50mg) exceeds maximum guideline limit (3mg) for AZATHIOPRINE.* | ✅ SUCCESS |
| `Clarithromycin` | `Clarithromycin` | `CLARITHROMYCIN` | `CLARITHROMYCIN` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Lasix 250mg TDS` | `Iaainl Img T18` | `IMATINIB 1mg tds` | `IMATINIB` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ❌ FAIL |
| `Lasix 250mg` | `Lasix 250mg` | `LASIX 250mg` | `LASIX` | **DANGER**: *Daily dose (250mg) exceeds maximum guideline limit (160mg) for FUROSEMIDE.* | ✅ SUCCESS |
| `Lipitor 10` | `Lipitor 10` | `LIPITOR 10` | `LIPITOR` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Methotrexate 7.5mg Daily` | `Methotrexate 7.5mg Daily` | `METHOTREXATE 7.5mg Daily` | `METHOTREXATE` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Methotrexate 7.5mg` | `Methotrexate 7.5mg` | `METHOTREXATE 7.5mg` | `METHOTREXATE` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Panadol 1g BD` | `Panadol 1g BD` | `PANADOL 1g BD` | `PANADOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Panadol 1g` | `Panadol Ia` | `PANADOL 1000mg` | `PANADOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Simvastatin 40mg + Clarithromycin` | `Simvastatin, Clarithromycin 40mg` | `SIMVASTATIN Clarithromycin 40mg` | `SIMVASTATIN` | **DANGER**: *Lethal drug interaction: Clarithromycin co-administration contraindicated with Simvastatin due to severe risk of rhabdomyolysis.* | ✅ SUCCESS |
| `Simvastatin 40mg` | `Simvastatin 40mg` | `SIMVASTATIN 40mg` | `SIMVASTATIN` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Tylenol 150 BD` | `Tylenol 150 BD` | `TYLENOL 150 BD` | `TYLENOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Tylenol 150` | `Tylenol 150` | `TYLENOL 150` | `TYLENOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
