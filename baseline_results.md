# OCR Batch Evaluation Report

**Timestamp:** 2026-06-22T00:44:38.994Z
**Overall Accuracy:** 13/18 (72.22%)

## Detailed Results Matrix

| File Name / Ground Truth | Raw OCR Decoded | Post-Processed / DB Verified | DB Match | Safety Verdict | Status |
| --- | --- | --- | --- | --- | --- |
| `Amoxil 2gm Daily` | `Amosil ser ros Waily` | `AMOXIL 500mg 200mg daily` | `AMOXIL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ❌ FAIL |
| `Amoxil 500mg TDS` | `Amesit Bmg TD` | `AMOXIL 500mg tds` | `AMOXIL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Amoxil 500mg` | `Afmosit Emg` | `AMOXIL 500mg` | `AMOXIL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Anugmontin 625` | `Anugmonti fd8` | `AUGMENTIN 625mg` | `AUGMENTIN` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Azathioprine 50mg Daily` | `Axattioprine Bmg Tils` | `AZATHIOPRINE 50mg daily` | `AZATHIOPRINE` | **DANGER**: *Daily dose (50mg) exceeds maximum guideline limit (3mg) for AZATHIOPRINE.* | ✅ SUCCESS |
| `Azathioprine 50mg` | `Arattioprin Bmy` | `AZATHIOPRINE 50mg` | `AZATHIOPRINE` | **DANGER**: *Daily dose (50mg) exceeds maximum guideline limit (3mg) for AZATHIOPRINE.* | ✅ SUCCESS |
| `Clarithromycin` | `Clarithrompcin` | `CLARITHROMYCIN` | `CLARITHROMYCIN` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Lasix 250mg TDS` | `Iaainl Img T18` | `IMATINIB 1mg tds` | `IMATINIB` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ❌ FAIL |
| `Lasix 250mg` | `Iaginle LBOlmg` | `IODINE 1500mg` | `IODINE` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ❌ FAIL |
| `Lipitor 10` | `Sr ipitir oAd eo` | `10mg LIPITOR 20mg 50mg` | `LIPITOR` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ❌ FAIL |
| `Methotrexate 7.5mg Daily` | `Methatraeatp IBmg aes eop` | `METHOTREXATE 7.5mg 250mg 500mg` | `METHOTREXATE` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ❌ FAIL |
| `Methotrexate 7.5mg` | `Methatrreatp Ierng` | `METHOTREXATE 7.5mg` | `METHOTREXATE` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Panadol 1g BD` | `Hanatol a Ig Rfy` | `PANADOL a 1000mg bd` | `PANADOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Panadol 1g` | `Panadol Ia` | `PANADOL 1000mg` | `PANADOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Simvastatin 40mg + Clarithromycin` | `Simrastatin Iemy te CCarithromyein` | `SIMVASTATIN 40mg CCarithromyein` | `SIMVASTATIN` | **DANGER**: *Lethal drug interaction: Clarithromycin co-administration contraindicated with Simvastatin due to severe risk of rhabdomyolysis.* | ✅ SUCCESS |
| `Simvastatin 40mg` | `Simrastatin KDmg` | `SIMVASTATIN 40mg` | `SIMVASTATIN` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Tylenol 150 BD` | `Tylonod LBOd Bl` | `TYLENOL 150mg bd` | `TYLENOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
| `Tylenol 150` | `Tylanod LBO9` | `TYLENOL 150mg` | `TYLENOL` | **PASS**: *Dosage Matches NSTG Guidelines. No Known Interactions.* | ✅ SUCCESS |
