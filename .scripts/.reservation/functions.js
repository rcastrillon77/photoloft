async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !bookingData) {
    console.error("❌ Booking not found or error:", error);
    return;
  }

  const [user, transaction, events, locations] = await Promise.all([
    supabase.from("users").select("*").eq("uuid", bookingData.user_id).maybeSingle(),
    supabase.from("transactions").select("*").eq("uuid", bookingData.transaction_id).maybeSingle(),
    supabase.from("events").select("*").in("uuid", bookingData.event_id).then(res => res.data || []),
    supabase.from("locations").select("*").in("uuid", bookingData.location_id).then(res => res.data || [])
  ]);

  if (!user.data) console.warn("⚠️ User not found");
  if (!transaction.data) console.warn("⚠️ Transaction not found");
  if (!events.length) console.warn("⚠️ No events found");
  if (!locations.length) console.warn("⚠️ No locations found");

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return false;
  }

  const details = {
    booking_uuid: bookingData.uuid,
    listing_uuid: bookingData.listing_id,
    transaction_uuid: bookingData.transaction_id,
    event_uuid: bookingData.event_id,
    user_uuid: bookingData.user_id,
    
    start: bookingData.details.start,
    end: bookingData.details.end,
    duration: bookingData.details.duration,
    timezone: bookingData.details.timezone,
    status: bookingData.status,
    cameras: bookingData.cameras,
    attendees: bookingData.details.attendees,
    activities: bookingData.activities,
  
    transaction: {
      base_rate: bookingData.details.transaction.base_rate,
      final_rate: bookingData.details.transaction.final_rate,
      rate_label: bookingData.details.transaction.rate_label,
      discounts: bookingData.details.transaction.discounts,
      credits_applied: bookingData.details.transaction.user_credits_applied,
      subtotal: bookingData.details.transaction.subtotal,
      tax_rate: bookingData.details.transaction.tax_rate,
      tax_subtotal: bookingData.details.transaction.tax_total,
      total: bookingData.details.transaction.total
    },
  
    user: {
      first_name: bookingData.details.user.first_name,
      last_name: bookingData.details.user.last_name,
      email: bookingData.details.user.email,
      phone: bookingData.details.user.phone,
      membership: bookingData.details.user.membership
    },
  
    listing: {
      name: bookingData.details.listing.name,
      address: {
        address_line_1: bookingData.details.listing.address_line_1,
        address_line_2: bookingData.details.listing.address_line_2,
        city: bookingData.details.listing.city,
        state: bookingData.details.listing.state,
        zip_code: bookingData.details.listing.zip_code
      }
    }
  };

  console.log("✅ Booking details updated.");
  return true;

function populateReservationDetails(details) {
  if (!details) return;

  const start = luxon.DateTime.fromISO(details.start);
  const end = luxon.DateTime.fromISO(details.end);

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
  document.getElementById("details_end").textContent = end.toFormat("h:mm a");

  document.getElementById("details_duration").textContent =
    `${details.duration || '?'} Hours`;

  document.getElementById("details_attendees").textContent =
    `${details.attendees || '?'} People`;

  document.getElementById("details_paid").textContent =
    `$${(details.transaction?.total || 0).toFixed(2)}`;
}

}
