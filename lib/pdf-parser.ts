// PDF Itinerary Parser for Dispatch
// Extracts trip data from driver itinerary PDFs

export interface ParsedItinerary {
  tripNumber: string;
  startDate: string;
  driverName: string;
  dispatcherEmail: string;
  totalMiles: number;
  truck: string;
  trailer: string;
  pickup: {
    location: string;
    address: string;
    city: string;
    province: string;
    company: string;
    scheduledTime?: string;
    reference: string;
    cargoDescription: string;
    weight: string;
    pieces: string;
    notes?: string;
  };
  delivery: {
    location: string;
    address: string;
    city: string;
    province: string;
    company: string;
    scheduledTime: string;
    reference: string;
    cargoDescription: string;
    notes?: string;
  };
  stops: Array<{
    stopType: 'PICKUP' | 'DELIVER';
    location: string;
    address: string;
    city: string;
    province: string;
    company: string;
    scheduledTime?: string;
    milesFromLast: number;
    reference?: string;
    cargoDescription?: string;
    notes?: string;
  }>;
  rawText: string;
}

export function parseItineraryText(text: string): ParsedItinerary {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  
  // Extract trip number
  const tripMatch = text.match(/Trip Itinerary\s+([A-Z]\d+)/i) || text.match(/T(\d+)/i);
  const tripNumber = tripMatch ? (tripMatch[1].startsWith('T') ? tripMatch[1] : 'T' + tripMatch[1]) : '';
  
  // Extract start date
  const startDateMatch = text.match(/Start Date:\s*([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})/i);
  const startDate = startDateMatch ? startDateMatch[1] : '';
  
  // Extract driver name
  const driverMatch = text.match(/Lead Driver\s+([A-Z\s]+?)(?=\s+Team|$)/i);
  const driverName = driverMatch ? driverMatch[1].trim() : '';
  
  // Extract dispatcher email
  const emailMatch = text.match(/Dispatched By\s+([^\s]+@[^\s]+)/i);
  const dispatcherEmail = emailMatch ? emailMatch[1] : '';
  
  // Extract total miles
  const milesMatch = text.match(/TOTAL ROUTED MILES:\s*([\d,]+)/i);
  const totalMiles = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;
  
  // Extract truck
  const truckMatch = text.match(/Truck:\s*(\d+)/i);
  const truck = truckMatch ? truckMatch[1] : '';
  
  // Extract trailer
  const trailerMatch = text.match(/Trailer:\s*(\d+[A-Z]?)/i);
  const trailer = trailerMatch ? trailerMatch[1] : '';
  
  // Extract pickup info
  const pickupSection = text.match(/ACQUIRE[\s\S]*?(?=DELIVER)/i);
  const pickupText = pickupSection ? pickupSection[0] : '';
  
  const pickupLocationMatch = pickupText.match(/ACQUIRE\s*\(([^)]+)\)/i);
  const pickupCityProvince = pickupLocationMatch ? pickupLocationMatch[1] : '';
  const [pickupCity, pickupProvince] = pickupCityProvince.split(',').map(s => s.trim());
  
  const pickupAddressMatch = pickupText.match(/\d+\s+[^,\n]+/);
  const pickupAddress = pickupAddressMatch ? pickupAddressMatch[0].trim() : '';
  
  const pickupCompanyMatch = pickupText.match(/DM TRANSPORT[^-\n]*/i);
  const pickupCompany = pickupCompanyMatch ? pickupCompanyMatch[0].trim() : 'DM Transport';
  
  const pickupRefMatch = text.match(/P\/U Ref\.\s*#?\s*([^\s]+)/i) || text.match(/Bol No\.\s*([^-\n]+)/i);
  const pickupRef = pickupRefMatch ? pickupRefMatch[1].trim() : '';
  
  const pickupCargoMatch = text.match(/(\d+)\s*pcs?,\s*([\d,]+)\s*lbs?\s*([^#\n]+)/i);
  const pickupPieces = pickupCargoMatch ? pickupCargoMatch[1] : '';
  const pickupWeight = pickupCargoMatch ? pickupCargoMatch[2] : '';
  const pickupCargo = pickupCargoMatch ? pickupCargoMatch[3].trim() : '';
  
  // Extract delivery info
  const deliverySection = text.match(/DELIVER[\s\S]*?$/i);
  const deliveryText = deliverySection ? deliverySection[0] : '';
  
  const deliveryLocationMatch = deliveryText.match(/DELIVER\s*\(([^)]+)\)/i);
  const deliveryCityProvince = deliveryLocationMatch ? deliveryLocationMatch[1] : '';
  const [deliveryCity, deliveryProvince] = deliveryCityProvince.split(',').map(s => s.trim());
  
  const deliveryAddressMatch = deliveryText.match(/(\d+\s+[^,\n]+)/);
  const deliveryAddress = deliveryAddressMatch ? deliveryAddressMatch[1].trim() : '';
  
  const deliveryCompanyMatch = deliveryText.match(/[A-Z][A-Z\s]+QUARRY[^-\n]*/i);
  const deliveryCompany = deliveryCompanyMatch ? deliveryCompanyMatch[0].trim() : '';
  
  const deliveryScheduleMatch = deliveryText.match(/SCHEDULED FOR\s*-\s*([^\n]+)/i);
  const deliverySchedule = deliveryScheduleMatch ? deliveryScheduleMatch[1].trim() : '';
  
  // Build stops array
  const stops: ParsedItinerary['stops'] = [];
  
  // Add pickup stop
  if (pickupCity) {
    stops.push({
      stopType: 'PICKUP',
      location: pickupCityProvince,
      address: pickupAddress,
      city: pickupCity,
      province: pickupProvince,
      company: pickupCompany,
      milesFromLast: 0,
      reference: pickupRef,
      cargoDescription: `${pickupPieces} pcs, ${pickupWeight} lbs - ${pickupCargo}`.trim()
    });
  }
  
  // Add delivery stop
  if (deliveryCity) {
    stops.push({
      stopType: 'DELIVER',
      location: deliveryCityProvince,
      address: deliveryAddress,
      city: deliveryCity,
      province: deliveryProvince,
      company: deliveryCompany,
      scheduledTime: deliverySchedule,
      milesFromLast: totalMiles,
      notes: `Scheduled: ${deliverySchedule}`
    });
  }
  
  return {
    tripNumber,
    startDate,
    driverName,
    dispatcherEmail,
    totalMiles,
    truck,
    trailer,
    pickup: {
      location: pickupCityProvince,
      address: pickupAddress,
      city: pickupCity,
      province: pickupProvince,
      company: pickupCompany,
      reference: pickupRef,
      cargoDescription: `${pickupPieces} pcs, ${pickupWeight} lbs - ${pickupCargo}`.trim(),
      weight: pickupWeight,
      pieces: pickupPieces
    },
    delivery: {
      location: deliveryCityProvince,
      address: deliveryAddress,
      city: deliveryCity,
      province: deliveryProvince,
      company: deliveryCompany,
      scheduledTime: deliverySchedule,
      reference: pickupRef,
      cargoDescription: `${pickupPieces} pcs, ${pickupWeight} lbs - ${pickupCargo}`.trim()
    },
    stops,
    rawText: text
  };
}
