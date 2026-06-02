export interface HelpSection {
  title: string;
  body: string;
}

export interface HelpTopic {
  heading: string;
  sections: HelpSection[];
}

export const helpTopics: Record<string, HelpTopic> = {
  reports: {
    heading: 'Reports',
    sections: [
      {
        title: 'Overview',
        body: 'The Reports page is your main workspace. It lists all inspection reports in reverse date order, showing the date, customer, report type, inspector, and status at a glance.',
      },
      {
        title: 'Creating a Report',
        body: 'Click the "+ New Report" button to start a new inspection report. You will be taken to the report form where you can select the report type, customer, site, and fill in the inspection details.',
      },
      {
        title: 'Searching',
        body: 'Use the search box at the top to find reports by customer name, inspector name, or other information. Results update as you type.',
      },
      {
        title: 'Filtering',
        body: 'Click the "Filters" button to reveal filter options. You can filter by customer, report type (Loading & Inspection, Quarterly PERN Inspection, PERN Audit), status (Draft, Assigned, or Completed), and date range. There is also an "Assigned to me" filter to show only the reports assigned to you. A badge on the Filters button shows how many filters are active.',
      },
      {
        title: 'Report Actions',
        body: 'Each report row has actions:\n\n- Edit \u2014 Open the report for editing\n- PDF \u2014 Download the report as a formatted PDF document\n- Submit \u2014 On an Assigned report, mark it Completed and send it back to the owner\n- Reopen \u2014 On a Completed report, move it back to Assigned for further changes\n- Delete \u2014 Permanently remove the report (you will be asked to confirm)',
      },
      {
        title: 'Report Status',
        body: 'Reports move through three statuses:\n\n- Draft \u2014 being set up\n- Assigned \u2014 handed to an inspector to complete on site\n- Completed \u2014 signed off and back with the owner\n\nReopen a completed report if it needs further changes.',
      },
      {
        title: 'Pagination',
        body: 'Reports are shown 25 per page. Use the Prev and Next buttons at the bottom to navigate between pages.',
      },
    ],
  },

  'report-edit': {
    heading: 'Report Form',
    sections: [
      {
        title: 'Overview',
        body: 'The report form is used to create and edit inspection reports. The form adapts based on the selected report type, showing only the fields relevant to that type of inspection.',
      },
      {
        title: 'Report Type',
        body: 'Choose from three report types:\n\n- Loading & Inspection \u2014 Carried out as containers are loaded. Captures product grade, moisture readings, storage mode, container details, packaging content, and photos.\n- Quarterly PERN Inspection \u2014 A periodic site inspection. Includes a "Bale break performed?" toggle that reveals bale-break results and packaging-content checks when switched on.\n- PERN Audit \u2014 A comprehensive compliance audit with detailed site and process assessments.\n\nThe material being inspected is chosen from the Product Grade dropdown rather than being a separate report type.',
      },
      {
        title: 'Customer & Site',
        body: 'Select the customer and their inspection site from the dropdowns. If the customer or site doesn\'t exist yet, click the "+" button next to the dropdown to quickly add one without leaving the form. The "On Behalf Of" dropdown records the trading company the inspection is being carried out for (e.g. VISY, Genus, CTL) \u2014 also add-able on the fly with its "+" button.',
      },
      {
        title: 'Inspection Details',
        body: 'Fill in the core inspection fields: date, time, inspector name, who the inspection is carried out on behalf of, and a quality score (1 = poor, 5 = excellent). Record moisture readings (low/high) and storage mode. For Loading & Inspection, also capture the loading reference, number of containers, and stock/bale count.',
      },
      {
        title: 'Unwanted Materials & Contaminants',
        body: 'Check any unwanted materials or contaminants found during the inspection. These options come from lookup values. You can add notes for any item, or use the "Other / Notes" box for items not in the list.',
      },
      {
        title: 'Containers',
        body: 'For Loading & Inspection reports you can track individual containers. Click "+ Add Container" to record the container number, seal number, and the load details \u2014 number of bales, weighbridge ticket, and weight. Photos can be associated with specific containers.',
      },
      {
        title: 'Bale Break (Quarterly PERN)',
        body: 'On a Quarterly PERN Inspection, use the "Bale break performed?" toggle. When switched on it reveals the bale-break results field and the packaging-content checks (e.g. "OCC exceeds 97.5%"). Leave it off and those extra fields stay hidden.',
      },
      {
        title: 'Assigning to an Inspector',
        body: 'Superusers can hand a report to another inspector. Fill in the header (date, site, contact, what is being inspected), pick the inspector in the "Assign To" dropdown, and use "Save & Assign". The inspector finds it under the "Assigned to me" filter, completes it on site, signs, and taps "Submit" to send it back marked Completed. Assigning is optional \u2014 leave it unassigned and complete the report yourself if you prefer.',
      },
      {
        title: 'PERN Audit Fields',
        body: 'PERN audit reports include extensive fields covering company details, site facilities, safety equipment, worker recording, PPE, accident logs, insurance, management experience, PRN expertise, packaging handling, training, and quality assessments.',
      },
      {
        title: 'Photos',
        body: 'Upload photos by clicking "Add Photos". You can optionally label each photo and, for Loading & Inspection reports, associate a photo with a specific container. Photos appear as thumbnails and can be removed individually.',
      },
      {
        title: 'Signature',
        body: 'Use the signature pad at the bottom of the form to capture the inspector\'s signature. Click and drag (or use your finger on a touchscreen) to sign. Use the "Clear" button to start over.',
      },
      {
        title: 'Saving',
        body: 'Use "Save as Draft" to save work in progress. If you are handing the report to an inspector, choose them in "Assign To" and use "Save & Assign". The assigned inspector taps "Submit" once it is finished. To complete a report yourself, use "Save & Complete". "Cancel" returns to the reports list without saving.',
      },
    ],
  },

  customers: {
    heading: 'Customers',
    sections: [
      {
        title: 'Overview',
        body: 'The Customers page lets you manage your customer list and their inspection sites. Customers are the companies whose materials you inspect.',
      },
      {
        title: 'Adding a Customer',
        body: 'Click "+ New Customer" and fill in the customer details. Only the customer name is required. You can also add a contact name, email, phone number, and address.',
      },
      {
        title: 'Editing a Customer',
        body: 'Click the "Edit" button next to any customer to update their details. The form will appear at the top of the page pre-filled with the current information.',
      },
      {
        title: 'Deactivating a Customer',
        body: 'Rather than deleting customers (which could affect existing reports), you can deactivate them. Deactivated customers won\'t appear in dropdown lists when creating new reports, but their existing reports are preserved. Click "Activate" to restore them.',
      },
      {
        title: 'Managing Sites',
        body: 'Click on a customer in the list to view and manage their sites in the right panel. Each customer can have multiple inspection sites (addresses). Type a new site address and click "Add" or press Enter. You can edit or deactivate sites just like customers.',
      },
      {
        title: 'Quick Add from Reports',
        body: 'You can also add new customers directly from the report form using the "+" button next to the Customer dropdown, without navigating away.',
      },
    ],
  },

  users: {
    heading: 'Users',
    sections: [
      {
        title: 'Overview',
        body: 'The Users page is available to superusers only. It lets you manage user accounts for the application.',
      },
      {
        title: 'Adding a User',
        body: 'Click "+ New User" and fill in the username, display name, and password. Optionally check "Superuser" to grant admin access. All fields except superuser status are required for new users.',
      },
      {
        title: 'Editing a User',
        body: 'Click "Edit" next to any user to change their details. When editing, leave the password field blank to keep the current password, or enter a new one to change it.',
      },
      {
        title: 'Superuser Access',
        body: 'Superusers can access the Users management page and have full administrative control. Regular users can create and manage reports, customers, and lookups, but cannot manage other user accounts.',
      },
      {
        title: 'Deactivating a User',
        body: 'Click "Deactivate" to prevent a user from logging in. Their account and associated reports are preserved. Click "Activate" to restore access.',
      },
    ],
  },

  lookups: {
    heading: 'Lookup Values',
    sections: [
      {
        title: 'Overview',
        body: 'Lookup values populate the dropdown lists and checkbox options used throughout the report form. Keeping these up to date ensures inspectors can quickly select the right options.',
      },
      {
        title: 'Lookup Categories',
        body: "The lookup categories are:\n\n- Product Descriptions \u2014 The types of materials being inspected\n- Product Grades \u2014 Quality grades for materials\n- Storage Modes \u2014 How materials are stored (e.g. baled, loose)\n- Unwanted Materials \u2014 Materials that shouldn't be present\n- Contaminants \u2014 Contaminating substances found during inspection\n- Clients (On Behalf Of) \u2014 The trading companies inspections are carried out for",
      },
      {
        title: 'Report Type Association',
        body: 'Some lookup values are associated with a specific report type (Loading & Inspection or Quarterly PERN), so the options shown in the report form change with the selected type. Storage Modes and Clients (On Behalf Of) are shared across all types.',
      },
      {
        title: 'Adding a Value',
        body: 'Type the new value in the text field, select the report type if applicable, and click "Add" or press Enter.',
      },
      {
        title: 'Editing a Value',
        body: 'Click "Edit" next to any value to change its text. Press Enter or click "Save" to confirm, or "Cancel" to discard changes.',
      },
      {
        title: 'Deactivating a Value',
        body: 'Click "Deactivate" to hide a value from dropdown lists without deleting it. Existing reports that use the value are not affected. Click "Activate" to restore it.',
      },
    ],
  },
};
