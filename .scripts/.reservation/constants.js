const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}

window.bookingGlobals = {
  booking_uuid: null,
  listing_uuid: null,
  transaction_uuid: null,
  event_uuid: [],
  user_uuid: null,
  
  start: null,
  end: null,
  duration: null,
  date: null,
  timezone: null,
  status: null,
  cameras: true,
  attendees: null,
  activities: [],

  transaction: {
    base_rate: null,
    final_rate: null,
    rate_label: null,
    discounts: [],
    credits_applied: null,
    subtotal: null,
    tax_rate: null,
    tax_subtotal: null,
    total: null
  },

  user: {
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    membership: null
  },

  listing: {
    name: null,
    address: {
      address_line_1: null,
      address_line_2: null,
      city: null,
      state: null,
      zip_code: null
    }
  }
};