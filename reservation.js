const hello = "hello world";

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
        events (
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
  
      start: events?.start || null,
      end: events?.end || null,
      timezone: events?.timezone || null,
  
      location_name: locations?.name || null,
      location_address: locations?.address || null,
  
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

  
function populateBookingDetailsUI() {
    const formatCurrency = (amount) => `$${Number(amount || 0).toFixed(2)}`;
    const formatDate = (dateStr) => luxon.DateTime.fromISO(dateStr).toFormat("DDD • t");
  
    document.getElementById("details_start").textContent = formatDate(bookingDetails.start);
    document.getElementById("details_end").textContent = formatDate(bookingDetails.end);
    document.getElementById("details_duration").textContent = `${bookingDetails.duration || "?"} minutes`;
    document.getElementById("details_location").textContent = bookingDetails.location_name || "—";
    document.getElementById("details_rate_label").textContent = bookingDetails.rate_label || "—";
    document.getElementById("details_user_credits").textContent = bookingDetails.user_credits_applied > 0 ? formatCurrency(bookingDetails.user_credits_applied) : "None";
  
    const totalDiscount = Object.values(bookingDetails.discounts || {}).reduce((sum, val) => sum + Number(val || 0), 0);
    document.getElementById("details_discount").textContent = totalDiscount > 0 ? formatCurrency(totalDiscount) : "None";
  
    document.getElementById("details_subtotal").textContent = formatCurrency(bookingDetails.subtotal);
    document.getElementById("details_tax").textContent = formatCurrency(bookingDetails.tax_subtotal);
    document.getElementById("details_total").textContent = formatCurrency(bookingDetails.total);
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

    populateBookingDetailsUI();
  })();
  