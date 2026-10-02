// Copy for the resale page. Every statement mirrors behaviour in the API
// (apps/api/src/controllers/resaleController.js) or existing screens; keep them in sync if those rules change.

// Cities offered by the resale filter (unchanged from the previous resale page)
export const RESALE_CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Multan', 'Peshawar'];

// The cap the API enforces when a ticket is listed: Math.floor(originalPrice * 1.10)
export const RESALE_CAP_PERCENT = 110;

export const RESALE_STEPS = [
  {
    title: 'Own it',
    // listTicketForResale: ownership check + status === 'ACTIVE' + no other ACTIVE listing
    copy: 'Tickets you buy on TicketLedger sit in your wallet. Any active ticket you own that hasn’t been scanned can be listed, one listing per ticket.',
    link: { label: 'Open my wallet', to: '/wallet' },
  },
  {
    title: 'Price it',
    // maxResalePrice = Math.floor(originalPrice * 1.10); higher prices are rejected
    copy: 'Set your price, up to 110% of the face value you paid. Anything above that ceiling is rejected when you submit, so every listing here is within the cap.',
  },
  {
    title: 'Get seen',
    // Waitlist users of that event receive a RESALE_TICKET_AVAILABLE notification
    copy: 'Your listing appears on this page straight away, and fans on that event’s waitlist get a notification that a ticket is available.',
  },
  {
    title: 'Buy',
    // buyResaleTicket: requires sign-in, listing must be ACTIVE, buyer cannot be the seller
    copy: 'Signed-in fans pick a listing and confirm. A listing that has just sold or been cancelled can’t be bought, and you can’t buy your own.',
  },
  {
    title: 'Walk in',
    // Transaction: ticket.userId -> buyer, new qrNonce, TicketTransferHistory row, notifications to both sides
    copy: 'The ticket moves to the buyer’s account with a brand-new rotating QR. The seller’s old QR stops working, and the transfer is added to the ticket’s history.',
    link: { label: 'See my tickets', to: '/wallet' },
  },
];

export const RESALE_FAQS = [
  {
    q: 'How is the resale price capped?',
    a: 'The highest price you can ask is 110% of the ticket’s original price, rounded down to the nearest rupee. For a Rs. 2,500 ticket that is Rs. 2,750. The ceiling is checked when you list, and each card here shows the face value and the ceiling next to the asking price.',
  },
  {
    q: 'Which tickets can I list?',
    a: 'Only tickets you own that are still active. Tickets that have been scanned at the gate, cancelled or already resold can’t be listed, and a ticket that already has an active listing can’t be listed twice.',
  },
  {
    q: 'Can I change my price or take a listing down?',
    a: 'There is no price edit. Cancel the listing from NFT Tickets and list the ticket again at the new price. Cancelling keeps the ticket in your wallet.',
  },
  {
    q: 'What happens to the seller’s QR code?',
    a: 'When a resale purchase completes, the ticket gets a new QR code and the previous one is revoked, so a screenshot of the old pass won’t get anyone through the gate.',
  },
  {
    q: 'What if the ticket sells before I confirm?',
    a: 'The purchase only goes through while the listing is still active. If someone else bought it first or the seller cancelled, you’ll see an error and nothing changes hands.',
  },
  {
    q: 'How do I hear about tickets for a sold-out event?',
    a: 'Join the waitlist on the event’s page once it’s sold out. Whenever a fan lists a ticket for that event, everyone on the waitlist gets a notification.',
  },
];
