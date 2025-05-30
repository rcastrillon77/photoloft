// BOOKING GLOBALS

window.bookingDetails = {
    booking_id: null,
    user_id: null,
    listing_id: null,
    location_id: null,
    transaction_id: null,
    status: null,
    entry_code: null,
    source: null,
    type: null,
    certificate_id: [],
    cameras: null,
    details: {},
    membership: null,
  
    start: null,
    end: null,
    timezone: null,
  
    location_name: null,
    location_address: null,
  
    base_rate: null,
    final_rate: null,
    rate_label: null,
    user_credits_applied: null,
    discounts: [],
    discount_total: 0,
    subtotal: null,
    tax_rate: null,
    tax_subtotal: null,
    total: null
  };
  

async function fetchBookingDetails(bookingId) {
    const { data, error } = await window.supabase
      .from("bookings")
      .select(`
        uuid,
        user_id,
        listing_id,
        location_id,
        transaction_id,
        status,
        entry_code,
        source,
        type,
        certificate_id,
        cameras,
        details,
        events:event_id (
          start,
          end,
          timezone
        ),
        locations:location_id (
          name,
          address
        ),
        transactions:transaction_id (
          base_rate,
          final_rate,
          rate_label,
          user_credits_applied,
          discounts,
          discount_total,
          subtotal,
          tax_rate,
          taxes_total,
          total
        ),
        users:user_id (
          first_name
          last_name
          email
          membership
        )
      `)
      .eq("uuid", bookingId)
      .maybeSingle();
  
    if (error || !data) {
      console.error("❌ Booking not found or error:", error);
      alert("Booking not found.");
      return false;
    }
  
    const { events, locations, transactions, users } = data;
  
    Object.assign(window.bookingDetails, {
      booking_id: data.uuid,
      user_id: data.user_id,
      listing_id: data.listing_id,
      location_id: data.location_id,
      transaction_id: data.transaction_id,
      status: data.status,
      entry_code: data.entry_code,
      source: data.source,
      type: data.type,
      certificate_id: data.certificate_id,
      cameras: data.cameras,
      details: data.details || {},
      membership: users?.membership || null,
      first_name: users?.first_name || null,
      last_name: users?.last_name || null,
      email: users?.email || null,
  
      start: events?.start || null,
      end: events?.end || null,
      timezone: events?.timezone || null,
  
      location_name: locations?.name || null,
      location_address: locations?.address || null,
      attendees: data.details.attendees || null,
      activities: data.details.activities || {},
  
      base_rate: transactions?.base_rate ?? null,
      final_rate: transactions?.final_rate ?? null,
      rate_label: transactions?.rate_label || null,
      user_credits_applied: transactions?.user_credits_applied ?? null,
      discounts: transactions?.discounts || [],
      discount_total: transactions?.discount_total ?? 0,
      subtotal: transactions?.subtotal ?? null,
      tax_rate: transactions?.tax_rate ?? null,
      tax_subtotal: transactions?.taxes_total ?? null,
      total: transactions?.total ?? null
    });
  
    return true;
}

  
function populateDetailsSidebar() {
    const { first_name, last_name, start, end, timezone, duration, attendees, total, type } = bookingDetails;
  
    // Format date and time
    const luxonStart = luxon.DateTime.fromISO(start, { zone: timezone });
    const luxonEnd = luxon.DateTime.fromISO(end, { zone: timezone });
  
    const formattedDate = luxonStart.toFormat("EEEE MMMM d, yyyy");
    const formattedStart = luxonStart.toFormat("h:mm a");
    const formattedEnd = luxonEnd.toFormat("h:mm a");
    const tzAbbr = luxonEnd.offsetNameShort || luxonEnd.toFormat("ZZZZ");
  
    const guestName = `${first_name} ${last_name}`;
    const durationLabel = `${duration} Hour${duration === 1 ? "" : "s"}`;
    const attendeesLabel = `${attendees} ${attendees === 1 ? "Person" : "People"}`;
    const totalLabel = `$${total.toFixed(2)}`;
  
    document.getElementById("details_user").textContent = guestName;
    document.getElementById("details_date").textContent = formattedDate;
    document.getElementById("details_start").textContent = formattedStart;
    document.getElementById("details_end").textContent = `${formattedEnd} ${tzAbbr}`;
    document.getElementById("details_duration").textContent = durationLabel;
    document.getElementById("details_attendees").textContent = attendeesLabel;
    document.getElementById("details_paid").textContent = totalLabel;
  
    // Disable reschedule/cancel if type is "rescheduled"
    if (type === "rescheduled") {
      document.getElementById("actions_cancel")?.classList.add("disabled");
      document.getElementById("actions_reschedule")?.classList.add("disabled");
    }
  }
  
  

(async function initReservationPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const bookingId = urlParams.get("booking");
  
    if (!bookingId) {
      console.warn("⚠️ No booking ID in URL.");
      return;
    }
  
    const success = await fetchBookingDetails(bookingId);
    /*
    if (!success) return;
  
    const allowedMemberships = ["free-members", "paid-members"];
    const userIsAllowed = allowedMemberships.includes(window.bookingDetails.membership);
  
    if (!userIsAllowed && !window.supabaseUser?.id) {
      alert("🔐 Please log in to view this booking.");
      // TODO: redirect or show login prompt
      return;
    }
    */
  
    console.log("📦 Loaded bookingDetails:", window.bookingDetails);
    // TODO: Show booking info in UI
    
    populateDetailsSidebar();
  })();
  