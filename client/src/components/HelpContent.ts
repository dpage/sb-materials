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
        body: 'Click the "Filters" button to reveal filter options. You can filter by customer, report type (Fibre, Plastics, Metals, PERN), status (Draft or Completed), and date range. A badge on the Filters button shows how many filters are active.',
      },
      {
        title: 'Report Actions',
        body: 'Each report has three actions:\n\n- Edit \u2014 Open the report for editing\n- PDF \u2014 Download the report as a formatted PDF document\n- Delete \u2014 Permanently remove the report (you will be asked to confirm)',
      },
      {
        title: 'Report Status',
        body: 'Reports are either "Draft" or "Completed". Draft reports are still being worked on. Set a report to Completed and add a completion date when the inspection is finalised.',
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
        body: 'Choose from four report types:\n\n- Fibre Inspection \u2014 For fibre material inspections, includes moisture readings, bale counts, and storage mode\n- Plastics Inspection \u2014 For plastics material inspections, includes container tracking and loading references\n- Metals Inspection \u2014 For metals material inspections, similar to plastics\n- PERN Audit \u2014 A comprehensive compliance audit form with detailed site and process assessments',
      },
      {
        title: 'Customer & Site',
        body: 'Select the customer and their inspection site from the dropdowns. If the customer or site doesn\'t exist yet, click the "+" button next to the dropdown to quickly add one without leaving the form.',
      },
      {
        title: 'Inspection Details',
        body: 'Fill in the core inspection fields: date, time, inspector name, and quality score (1\u201310). For fibre inspections, record moisture readings (low/high), storage mode, and bale count. For plastics/metals, record the loading reference and number of containers.',
      },
      {
        title: 'Unwanted Materials & Contaminants',
        body: 'Check any unwanted materials or contaminants found during the inspection. These options come from lookup values and are specific to the report type. You can add notes for any item, or use the "Other" field for items not in the list.',
      },
      {
        title: 'Containers',
        body: 'For plastics and metals inspections, you can track individual containers. Click "+ Add Container" to add container numbers, seal numbers, and weight information. Photos can be associated with specific containers.',
      },
      {
        title: 'PERN Audit Fields',
        body: 'PERN audit reports include extensive fields covering company details, site facilities, safety equipment, worker recording, PPE, accident logs, insurance, management experience, PRN expertise, packaging handling, training, and quality assessments.',
      },
      {
        title: 'Photos',
        body: 'Upload photos by clicking "Add Photos". You can optionally label each photo and, for plastics/metals inspections, associate a photo with a specific container. Photos appear as thumbnails and can be removed individually.',
      },
      {
        title: 'Signature',
        body: 'Use the signature pad at the bottom of the form to capture the inspector\'s signature. Click and drag (or use your finger on a touchscreen) to sign. Use the "Clear" button to start over.',
      },
      {
        title: 'Saving',
        body: 'Click "Save Report" to save your work. The report will be saved as a draft by default. Set the status to "Completed" and add a completion date when the inspection is finalised. Use "Cancel" to go back to the reports list without saving.',
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
        body: "There are five categories of lookup values:\n\n- Product Descriptions \u2014 The types of materials being inspected\n- Product Grades \u2014 Quality grades for materials\n- Storage Modes \u2014 How materials are stored (e.g. baled, loose)\n- Unwanted Materials \u2014 Materials that shouldn't be present\n- Contaminants \u2014 Contaminating substances found during inspection",
      },
      {
        title: 'Report Type Association',
        body: 'Most lookup values are associated with a specific report type (Fibre, Plastics, or Metals). This means the options shown in the report form will change depending on the selected report type. Storage Modes are shared across all types.',
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
