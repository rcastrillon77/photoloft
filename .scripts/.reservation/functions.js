async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !bookingData) {
    console.error("❌ Booking not found or error:", error);
    return null;
  }

  const [user, transaction, events, locations] = await Promise.all([
    supabase.from("users").select("*").eq("uuid", bookingData.user_id).maybeSingle(),
    supabase.from("transactions").select("*").eq("uuid", bookingData.transaction_id).maybeSingle(),
    supabase.from("events").select("*").in("uuid", bookingData.event_id).then(res => res.data || []),
    supabase.from("locations").select("*").in("uuid", bookingData.location_id).then(res => res.data || [])
  ]);

  const firstEvent = events[0] || {};
  const firstLocation = locations[0] || {};

  const details = {
    start: firstEvent.start || null,
    end: firstEvent.end || null,
    duration: firstEvent.duration || null,
    attendees: bookingData.details?.attendees || null,
    user: {
      first_name: user.data?.first_name || "",
      last_name: user.data?.last_name || "",
      email: user.data?.email || "",
      phone: user.data?.phone || "",
      membership: user.data?.membership || "guest"
    },
    listing: bookingData.details?.listing || {
      name: firstLocation.name || "",
      address_line_1: firstLocation.address?.address_line_1 || "",
      address_line_2: firstLocation.address?.address_line_2 || "",
      city: firstLocation.address?.city || "",
      state: firstLocation.address?.state || "",
      zip_code: firstLocation.address?.zip_code || "",
      timezone: firstEvent.timezone || "America/Chicago",
      coordinates: firstLocation.coordinates || {}
    },
    activities: bookingData.details?.activities || [],
    transaction: {
      subtotal: transaction.data?.subtotal || 0,
      total: transaction.data?.total || 0,
      tax_rate: transaction.data?.tax_rate || 0,
      tax_total: transaction.data?.taxes_total || 0,
      discount_total: transaction.data?.discount_total || 0,
      base_rate: transaction.data?.base_rate || 0,
      final_rate: transaction.data?.final_rate || 0,
      rate_label: transaction.data?.rate_label || "",
      user_credits_applied: transaction.data?.user_credits_applied || 0,
      discounts: transaction.data?.discounts || []
    }
  };

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return null;
  }

  console.log("✅ Booking details updated.");
  return details;
}

function populateReservationDetails(details) {
  if (!details) return;

  const start = luxon.DateTime.fromISO(details.start).setZone(details.listing.timezone);
  const end = luxon.DateTime.fromISO(details.end).setZone(details.listing.timezone);

  document.getElementById("details_user").textContent =
    `${details.user?.first_name || ''} ${details.user?.last_name || ''}`;

  document.getElementById("details_listing").textContent =
    details.listing?.name || "";

  document.getElementById("details_address").innerHTML = `
    ${details.listing?.address_line_1 || ''} ${details.listing?.address_line_2 || ''}<br>
    ${details.listing?.city || ''}, ${details.listing?.state || ''} ${details.listing?.zip_code || ''}
  `;

  document.getElementById("details_date").textContent =
    start.toFormat("cccc LLLL d, yyyy");

  document.getElementById("details_start").textContent = start.toFormat("h:mm a");
  document.getElementById("details_end").textContent = end.toFormat("h:mm a z");

  document.getElementById("details_duration").textContent =
    `${details.duration/60 || '?'} Hours`;

  document.getElementById("details_attendees").textContent =
    `${details.attendees || '?'} People`;

  document.getElementById("details_paid").textContent =
    `$${(details.transaction?.total || 0).toFixed(2)}`;
}
