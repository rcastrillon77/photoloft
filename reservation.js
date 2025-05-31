const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}


async function rebuildBookingDetails(bookingUuid) {
  const { data, error } = await window.supabase
    .from("bookings")
    .select(`
      *,
      events:event_id (start, end, duration, timezone),
      locations:location_id (name, address, coordinates),
      transactions:transaction_id (
        subtotal, total, tax_rate, taxes_total,
        discount_total, user_credits_applied,
        base_rate, final_rate, rate_label, discounts
      ),
      users:user_id (
        first_name, last_name, email, phone, membership
      )
    `)
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !data) {
    console.error("❌ Booking not found or error:", error);
    return false;
  }

  const details = {
    start: data.events?.start || null,
    end: data.events?.end || null,
    duration: data.events?.duration || null,
    attendees: data.details?.attendees || null,
    user: {
      first_name: data.users?.first_name || "",
      last_name: data.users?.last_name || "",
      email: data.users?.email || "",
      phone: data.users?.phone || "",
      membership: data.users?.membership || "guest"
    },
    listing: {
      name: data.details?.listing?.name || "",
      city: data.details?.listing?.city || "",
      state: data.details?.listing?.state || "",
      timezone: data.details?.listing?.timezone || "",
      zip_code: data.details?.listing?.zip_code || "",
      address_line_1: data.details?.listing?.address_line_1 || "",
      address_line_2: data.details?.listing?.address_line_2 || "",
      coordinates: data.details?.listing?.coordinates || {}
    },
    activities: data.details?.activities || [],
    transaction: {
      subtotal: data.transactions?.subtotal || 0,
      total: data.transactions?.total || 0,
      tax_rate: data.transactions?.tax_rate || 0,
      tax_total: data.transactions?.taxes_total || 0,
      discount_total: data.transactions?.discount_total || 0,
      base_rate: data.transactions?.base_rate || 0,
      final_rate: data.transactions?.final_rate || 0,
      rate_label: data.transactions?.rate_label || "",
      user_credits_applied: data.transactions?.user_credits_applied || 0,
      discounts: data.transactions?.discounts || []
    }
  };

  const { error: updateError } = await window.supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return false;
  }

  console.log("✅ Booking details updated.");
  return true;
}


async function initReservationUpdate() {
  if (!bookingUuid) return;

  const success = await rebuildBookingDetails(bookingUuid);

  if (!success) {
    alert("Unable to load booking.");
    return;
  }

  // Optionally re-fetch and render UI now that details are up to date
  console.log("✅ Booking updated and ready");
}

initReservationUpdate();
