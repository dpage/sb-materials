import PdfPrinter from 'pdfmake';
import path from 'path';
import fs from 'fs';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { logger } from './logger';
import { SB_LOGO_DATA_URL } from './logo';

const INSPECTION_TYPES = ['loading_inspection', 'quarterly_pern'];

const printer = new PdfPrinter({
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

function formatReportType(type: string): string {
  const map: Record<string, string> = {
    loading_inspection: 'Loading & Inspection',
    quarterly_pern: 'Quarterly PERN Inspection',
    pern_audit: 'Packaging Regulations Supplier Declaration & Audit Form',
  };
  return map[type] || type;
}

function fieldRow(label: string, value: any): TableCell[][] {
  return [
    [
      { text: label, bold: true, margin: [0, 2, 0, 2] as [number, number, number, number] },
      { text: value?.toString() || '-', margin: [0, 2, 0, 2] as [number, number, number, number] },
    ],
  ];
}

function yesNo(val: any): string {
  if (val === null || val === undefined) return '-';
  if (val === 1 || val === true || val === 'YES') return 'YES';
  if (val === 0 || val === false || val === 'NO') return 'NO';
  return val.toString();
}

function getPhotoAsBase64(uploadsDir: string, filename: string): string | null {
  if (!filename) return null;
  const filePath = path.resolve(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (err) {
    logger.warn(`Failed to read photo ${filename}:`, err);
    return null;
  }
}

// Center an image using a single-cell table (pdfmake's reliable centering method)
function centeredImage(base64: string, width: number, marginBottom: number = 10): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            image: base64,
            width,
            alignment: 'center' as const,
            border: [false, false, false, false],
            margin: [0, 0, 0, 0] as [number, number, number, number],
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, marginBottom] as [number, number, number, number],
  } as any;
}

// Photo block: label + centered image, kept together on one page
function photoBlock(base64: string, label: string | null, width: number = 400): Content {
  const items: Content[] = [];
  if (label) {
    items.push({
      text: label,
      italics: true,
      alignment: 'center' as const,
      margin: [0, 5, 0, 3] as [number, number, number, number],
    });
  }
  items.push(centeredImage(base64, width));
  return { stack: items, unbreakable: true } as any;
}

export async function generatePdf(report: any, uploadsDir: string): Promise<Buffer> {
  const content: Content[] = [];

  // Title
  content.push({
    text: 'S.B. Materials UK LTD',
    style: 'companyName',
    alignment: 'center',
    margin: [0, 0, 0, 5] as [number, number, number, number],
  });

  content.push({
    text: formatReportType(report.report_type),
    style: 'header',
    alignment: 'center',
    margin: [0, 0, 0, 15] as [number, number, number, number],
  });

  if (report.report_type === 'pern_audit') {
    buildPernAudit(content, report, uploadsDir);
  } else if (INSPECTION_TYPES.includes(report.report_type) || report.report_type.startsWith('inspection_')) {
    buildInspectionReport(content, report, uploadsDir);
  }

  const docDefinition: TDocumentDefinitions = {
    content,
    styles: {
      companyName: { fontSize: 16, bold: true, color: '#1a5276' },
      header: { fontSize: 14, bold: true, color: '#2c3e50' },
      subheader: { fontSize: 12, bold: true, color: '#2c3e50' },
    },
    defaultStyle: { fontSize: 10 },
    pageMargins: [40, 70, 40, 50] as [number, number, number, number],
    header: () => ({
      columns: [
        { image: SB_LOGO_DATA_URL, width: 140, margin: [40, 15, 0, 0] as [number, number, number, number] },
        {
          stack: [
            { text: 'Stewart Bassett, Director', fontSize: 9, alignment: 'right' as const },
            {
              text: 'stewart@sbmaterials.co.uk · 07881 337457',
              fontSize: 8,
              alignment: 'right' as const,
              color: '#555',
            },
          ],
          margin: [0, 18, 40, 0] as [number, number, number, number],
        },
      ],
    }),
    footer: (currentPage: number, pageCount: number) => ({
      stack: [
        { text: 'NRW Waste Brokers registration CBDU027716', fontSize: 7, alignment: 'center' as const, color: '#555' },
        {
          text: 'SB Materials UK LTD · 1 Deva Way, Wrexham, Wales LL13 9EU · Registered in Wales & England No. 10896256',
          fontSize: 7,
          alignment: 'center' as const,
          color: '#555',
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 7,
          alignment: 'center' as const,
          margin: [0, 2, 0, 0] as [number, number, number, number],
        },
      ],
      margin: [40, 6, 40, 0] as [number, number, number, number],
    }),
  };

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ─── Inspection Reports (Fibre / Plastics / Metals) ───

function buildInspectionReport(content: Content[], report: any, uploadsDir: string) {
  const d = report.inspection_details || {};
  const isLoading = report.report_type === 'loading_inspection';
  const isQuarterlyPern = report.report_type === 'quarterly_pern';

  // Header fields
  const headerRows: TableCell[][] = [
    ...fieldRow('Report Reference', `SBM-${String(report.id).padStart(5, '0')}`),
    ...fieldRow('Status', (report.status || 'draft').charAt(0).toUpperCase() + (report.status || 'draft').slice(1)),
    ...fieldRow('Supplier Name', report.customer_name),
    ...fieldRow('Site Address', report.site_address),
  ];

  if (report.on_behalf_of) {
    headerRows.push(...fieldRow('On Behalf Of', report.on_behalf_of));
  }

  headerRows.push(
    ...fieldRow('Date of Inspection', report.inspection_date),
    ...fieldRow('Time of Inspection', report.inspection_time || '-'),
    ...fieldRow('Inspector', report.inspector_name),
  );

  headerRows.push(...fieldRow('Product Grade', d.product_grade));
  headerRows.push(...fieldRow('Mode of Storage', d.mode_of_storage));
  headerRows.push(...fieldRow('Moisture Reading Low', d.moisture_reading_low));
  headerRows.push(...fieldRow('Moisture Reading High', d.moisture_reading_high));
  if (isLoading) {
    headerRows.push(
      ...fieldRow('Product Description', d.product_description),
      ...fieldRow('Loading Reference', d.loading_reference),
      ...fieldRow('Number of Containers', d.number_of_containers),
      ...fieldRow('Stock & Bale Count', d.stock_bale_count),
      ...fieldRow('Radiation Reading', d.radiation_reading),
    );
  }

  headerRows.push(...fieldRow('Packaging Content', parseJsonField(d.packaging_thresholds)));
  if (d.rejected_bales) {
    headerRows.push(...fieldRow('Rejected Bales', d.rejected_bales));
  }

  if (isQuarterlyPern) {
    headerRows.push(...fieldRow('Bale Break Performed', yesNo(d.bale_break)));
    if (d.bale_break) {
      headerRows.push(...fieldRow('Bale Break Results', d.bale_break_results));
    }
  }

  content.push({
    table: { widths: [180, '*'], body: headerRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Unwanted materials
  if (report.unwanted_materials?.length) {
    content.push({
      text: 'Unwanted Materials',
      style: 'subheader',
      margin: [0, 10, 0, 5] as [number, number, number, number],
    });
    const items = report.unwanted_materials.map((m: any) => (m.notes ? `${m.material} - ${m.notes}` : m.material));
    content.push({ ul: items, margin: [20, 0, 0, 10] as [number, number, number, number] });
  }

  // Contaminants
  if (report.contaminants?.length) {
    content.push({
      text: 'Contaminants',
      style: 'subheader',
      margin: [0, 10, 0, 5] as [number, number, number, number],
    });
    const items = report.contaminants.map((c: any) => (c.notes ? `${c.contaminant} - ${c.notes}` : c.contaminant));
    content.push({ ul: items, margin: [20, 0, 0, 10] as [number, number, number, number] });
  }

  // Compliance
  content.push({ text: 'Compliance', style: 'subheader', margin: [0, 10, 0, 5] as [number, number, number, number] });
  const complianceRows: TableCell[][] = [];

  complianceRows.push(
    ...fieldRow('Does the material originate in the UK', d.material_originates_uk),
    ...fieldRow(
      'Is the supplier aware that the material purchase price quoted includes PERN revenue which is only eligible in UK?',
      d.supplier_aware_pern,
    ),
    ...fieldRow('Does the supplier have control of all volume coming in to the site?', d.supplier_controls_volume),
    ...fieldRow(
      'If NO, how does the supplier ensure all material is consistent in source & quality?',
      d.volume_consistency_notes,
    ),
    ...fieldRow('Does the site buy in pre-baled material?', d.site_buys_prebaled),
    ...fieldRow('If yes, how does the supplier ensure this is only UK packaging?', d.prebaled_uk_assurance),
    ...fieldRow(
      'Is the site aware of any material that is not defined as UK post consumer packaging?',
      d.site_aware_non_uk,
    ),
  );

  content.push({
    table: { widths: [220, '*'], body: complianceRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Quality score & pass/fail
  content.push({
    table: {
      widths: [180, '*'],
      body: [
        ...fieldRow('Quality Score', report.quality_score ? `${report.quality_score} / 5` : '-'),
        ...fieldRow('Inspection Passed', yesNo(report.inspection_passed)),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Containers (plastics/metals)
  if (report.containers?.length) {
    for (const container of report.containers) {
      content.push({
        text: `Container: ${container.container_number || '-'}`,
        style: 'subheader',
        margin: [0, 10, 0, 5] as [number, number, number, number],
      });
      const containerRows: TableCell[][] = [...fieldRow('Seal Number', container.seal_number)];
      const hasSplitFields = container.number_of_bales || container.weighbridge_ticket || container.weight;
      if (hasSplitFields) {
        containerRows.push(
          ...fieldRow('Bales', container.number_of_bales),
          ...fieldRow('Weighbridge Ticket', container.weighbridge_ticket),
          ...fieldRow('Weight', container.weight),
        );
      } else {
        containerRows.push(...fieldRow('Weight Info', container.weight_info));
      }
      content.push({
        table: { widths: [180, '*'], body: containerRows },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      });

      const containerPhotos = (report.photos || []).filter((p: any) => p.container_id === container.id);
      for (const photo of containerPhotos) {
        const base64 = getPhotoAsBase64(uploadsDir, photo.file_path);
        if (base64) {
          content.push(photoBlock(base64, photo.photo_label));
        }
      }
    }
  }

  // Moisture reading photos (grouped under a reserved photo_label)
  const moisturePhotos = (report.photos || []).filter(
    (p: any) => !p.container_id && p.photo_label === 'Moisture Readings',
  );
  if (moisturePhotos.length) {
    content.push({
      text: 'Moisture Reading Photos',
      style: 'subheader',
      margin: [0, 10, 0, 5] as [number, number, number, number],
    } as any);
    for (const photo of moisturePhotos) {
      const base64 = getPhotoAsBase64(uploadsDir, photo.file_path);
      if (base64) {
        content.push(photoBlock(base64, null));
      }
    }
  }

  // General photos (moisture-grouped photos are shown in their own section above)
  const generalPhotos = (report.photos || []).filter(
    (p: any) => !p.container_id && p.photo_label !== 'Moisture Readings',
  );
  if (generalPhotos.length) {
    content.push({
      text: 'Photos',
      style: 'subheader',
      margin: [0, 10, 0, 5] as [number, number, number, number],
      pageBreak: 'before',
    } as any);
    for (const photo of generalPhotos) {
      const base64 = getPhotoAsBase64(uploadsDir, photo.file_path);
      if (base64) {
        content.push(photoBlock(base64, photo.photo_label));
      }
    }
  }

  // Other information
  if (report.other_information) {
    content.push({
      text: 'Other Information',
      style: 'subheader',
      margin: [0, 15, 0, 5] as [number, number, number, number],
    });
    content.push({ text: report.other_information, margin: [0, 0, 0, 10] as [number, number, number, number] });
  }

  // Signature & completion
  appendSignatureBlock(content, report, uploadsDir);
}

// ─── PERN Audit Report ───

const PERN_PACKAGING_REGS = `The packaging waste regulations allow the issue of evidence – known as PRNs (or PERNs for exports) on used packaging that has been recycled to an approved standard in order for obligation producers to meet their recycling obligations.

To qualify for the issue of evidence, packaging waste must be UK sourced ie arisen as waste in the UK and not have been waste imported into the UK from countries outside the UK including Eire.

Evidence cannot be issued on:
• non-packaging waste
• Non-target materials for example contamination or the baling wire or strapping around bales you supply to your buyer or other re-processor.
• Packaging offcuts for example edge trim from a packaging manufacture that was never converted into packaging.
• End of waste loads that you will further process.

Evidence must be issued against packaging waste during the same compliance period that it was received for processing or exported.

Evidence can only be issued on the tonnage of qualifying material. This can include material that's reasonably associated with that material, for example items that cannot be easily removed before the recovery process. This is known as target material and includes:
• Labels glued to plastic or glass bottles
• Labels, tape and staples attached to cardboard boxes
• Plastic lids attached to plastic or glass bottles
• Labels glued to plastic film
• Other metals contained in drink cans

Definition of Packaging:
Taken from EU Packaging Waste Directive. 'Packaging' shall mean all products made of any materials of any nature to be used for the containment, protection, handling, delivery and presentation of goods, from raw materials to processed goods, from the producer to the user or the consumer. 'Non-returnable' items used for the same purposes shall also be considered to constitute packaging.

Further references / links:
Producer Responsibility (Packaging Waste) Regulations 2017
https://www.gov.uk/guidance/packaging-producer-responsibilities`;

function buildPernAudit(content: Content[], report: any, uploadsDir: string) {
  const p = report.pern_details || {};

  // Introductory letter (only if provided)
  if (p.intro_letter) {
    content.push({
      text: 'INTRODUCTORY LETTER',
      style: 'subheader',
      margin: [0, 5, 0, 8] as [number, number, number, number],
    });
    content.push({ text: p.intro_letter, margin: [0, 0, 0, 15] as [number, number, number, number], fontSize: 9 });
  }

  // Packaging regulations explanation
  content.push({
    text: 'THE PACKAGING WASTE REGULATIONS',
    style: 'subheader',
    margin: [0, 10, 0, 8] as [number, number, number, number],
    pageBreak: 'before',
  } as any);
  content.push({ text: PERN_PACKAGING_REGS, margin: [0, 0, 0, 15] as [number, number, number, number], fontSize: 9 });

  // Audit details
  content.push({
    text: 'Audit Details',
    style: 'subheader',
    margin: [0, 15, 0, 5] as [number, number, number, number],
    pageBreak: 'before',
  } as any);
  const headerRows: TableCell[][] = [
    ...fieldRow('Report Reference', `SBM-${String(report.id).padStart(5, '0')}`),
    ...fieldRow('Status', (report.status || 'draft').charAt(0).toUpperCase() + (report.status || 'draft').slice(1)),
    ...fieldRow('Company Name & Address', p.company_name_address),
    ...fieldRow('Audit Date', report.inspection_date),
    ...fieldRow('Contact Name', p.contact_name),
    ...fieldRow('Email', p.email),
    ...fieldRow('Phone', p.phone),
    ...fieldRow('Grades Supplied', p.grades_supplied),
    ...fieldRow('Inspector / Auditor', report.inspector_name),
  ];

  content.push({
    table: { widths: [180, '*'], body: headerRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Site details
  content.push({ text: 'Site Details', style: 'subheader', margin: [0, 10, 0, 5] as [number, number, number, number] });
  const siteRows: TableCell[][] = [
    ...fieldRow('Number of Workers', p.num_workers),
    ...fieldRow('Type of Site', parseJsonField(p.site_type)),
    ...fieldRow('Safety Inducted', p.safety_inducted),
    ...fieldRow('Materials Handled', p.materials_handled),
    ...fieldRow('PRN Accredited', p.prn_accredited),
    ...fieldRow('PRN Numbers', p.prn_numbers),
    ...fieldRow('Permits/Licences', p.permits_licences),
    ...fieldRow('Accreditations', parseJsonField(p.accreditations)),
    ...fieldRow('Site Facilities', parseJsonField(p.site_facilities)),
    ...fieldRow('Area Size', p.area_size),
    ...fieldRow('Process Flow', p.process_flow),
    ...fieldRow('Throughput', p.throughput),
    ...fieldRow('Waste Sources', parseJsonField(p.waste_sources)),
    ...fieldRow('Transfer Notes Checked', p.transfer_notes_checked),
  ];
  content.push({
    table: { widths: [220, '*'], body: siteRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Safety & Workers
  content.push({
    text: 'Safety & Workers',
    style: 'subheader',
    margin: [0, 10, 0, 5] as [number, number, number, number],
  });
  const safetyRows: TableCell[][] = [
    ...fieldRow('Safety Equipment', parseJsonField(p.safety_equipment)),
    ...fieldRow('Safety Comments', p.safety_comments),
    ...fieldRow('Worker Recording', parseJsonField(p.worker_recording)),
    ...fieldRow('Worker Recording Comments', p.worker_recording_comments),
    ...fieldRow('PPE Suitable', p.ppe_suitable),
    ...fieldRow('Uniform or Own', p.uniform_or_own),
    ...fieldRow('Accident Log', p.accident_log),
    ...fieldRow('Employer Liability Insurance', p.employer_liability),
    ...fieldRow('Public Liability Insurance', p.public_liability),
  ];
  content.push({
    table: { widths: [220, '*'], body: safetyRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Packaging Knowledge & Compliance
  content.push({
    text: 'Packaging Knowledge & Compliance',
    style: 'subheader',
    margin: [0, 10, 0, 5] as [number, number, number, number],
  });
  const packRows: TableCell[][] = [
    ...fieldRow('Management Experience', p.mgmt_experience),
    ...fieldRow('PRN Expertise', p.prn_expertise),
    ...fieldRow('Can Differentiate Packaging vs Non-Packaging', p.packaging_differentiation),
    ...fieldRow('How Packaging Identified on Arrival', p.packaging_identification),
    ...fieldRow('Non-UK Packaging Brought to Site', p.non_uk_packaging),
    ...fieldRow('Non-UK Comments', p.non_uk_comments),
    ...fieldRow('PRNs/PERNs Only Claimed Once', p.prn_claimed_once),
  ];
  content.push({
    table: { widths: [220, '*'], body: packRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Worker Training & Practice
  content.push({
    text: 'Worker Training & Practice',
    style: 'subheader',
    margin: [0, 10, 0, 5] as [number, number, number, number],
  });
  const trainRows: TableCell[][] = [
    ...fieldRow('Training Types', parseJsonField(p.training_types)),
    ...fieldRow('Training Scope', p.training_scope),
    ...fieldRow('How Training is Recorded', parseJsonField(p.training_recording)),
    ...fieldRow('Training Review Frequency', p.training_review_frequency),
    ...fieldRow('Training Records Inspected', p.training_records_inspected),
    ...fieldRow('Workers Consistent with Training', p.workers_consistent),
  ];
  content.push({
    table: { widths: [220, '*'], body: trainRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Bale Split & Quality
  content.push({
    text: 'Bale Split & Quality Discussion',
    style: 'subheader',
    margin: [0, 10, 0, 5] as [number, number, number, number],
  });
  const resultRows: TableCell[][] = [
    ...fieldRow('Bale Split Results', p.bale_split_results),
    ...fieldRow('Quality Discussion', p.quality_discussion),
    ...fieldRow('Follow Up', p.follow_up),
    ...fieldRow('Notes', p.notes),
  ];
  content.push({
    table: { widths: [220, '*'], body: resultRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Photos
  const photos = report.photos || [];
  if (photos.length) {
    content.push({
      text: 'Photos & Supporting Documents',
      style: 'subheader',
      margin: [0, 10, 0, 5] as [number, number, number, number],
      pageBreak: 'before',
    } as any);
    for (const photo of photos) {
      const base64 = getPhotoAsBase64(uploadsDir, photo.file_path);
      if (base64) {
        content.push(photoBlock(base64, photo.photo_label));
      }
    }
  }

  // Signature & completion
  content.push({ text: '', margin: [0, 10, 0, 0] as [number, number, number, number] });

  const sigRows: TableCell[][] = [
    ...fieldRow('Name of Auditor', report.inspector_name),
    ...fieldRow('Position', p.auditor_position),
    ...fieldRow('Date', report.date_completed || report.inspection_date),
  ];
  content.push({
    table: { widths: [180, '*'], body: sigRows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  appendSignatureBlock(content, report, uploadsDir);
}

// ─── Shared: Signature block ───

function appendSignatureBlock(content: Content[], report: any, uploadsDir: string) {
  const sigItems: Content[] = [];

  sigItems.push({ text: 'Signature', style: 'subheader', margin: [0, 15, 0, 5] as [number, number, number, number] });

  if (report.signature_path) {
    const sigBase64 = getPhotoAsBase64(uploadsDir, report.signature_path);
    if (sigBase64) {
      sigItems.push({
        image: sigBase64,
        width: 200,
        margin: [0, 0, 0, 5] as [number, number, number, number],
      } as any);
    } else {
      // Signature file missing - leave blank space
      sigItems.push({ text: '', margin: [0, 0, 0, 60] as [number, number, number, number] });
    }
  } else {
    // No signature recorded - leave blank space for ink signing
    sigItems.push({
      canvas: [{ type: 'line', x1: 0, y1: 50, x2: 250, y2: 50, lineWidth: 0.5, lineColor: '#cccccc' }],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    } as any);
  }

  sigItems.push({
    text: report.inspector_name || '_______________',
    margin: [0, 2, 0, 5] as [number, number, number, number],
  });

  if (report.date_completed) {
    sigItems.push({
      text: `Date: ${report.date_completed}`,
      margin: [0, 5, 0, 5] as [number, number, number, number],
    });
  } else {
    sigItems.push({ text: 'Date: _______________', margin: [0, 10, 0, 5] as [number, number, number, number] });
  }

  content.push({ stack: sigItems, unbreakable: true } as any);
}

function parseJsonField(val: any): string {
  if (!val) return '-';
  try {
    const arr = JSON.parse(val);
    if (Array.isArray(arr)) return arr.join(', ');
  } catch {
    /* ignore parse errors */
  }
  return val.toString();
}
