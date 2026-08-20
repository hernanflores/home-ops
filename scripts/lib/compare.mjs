export function buildComparison({ now, inventoryPath, trackerPath, profilePath, listings, trackers, evaluations }) {
  const trackerById = new Map(trackers.map((record) => [record.listing_id, record]));
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.listing.id, evaluation]));
  return {
    schema_version: 1,
    generated_at: now,
    inventory_path: inventoryPath,
    tracker_path: trackerPath,
    profile_path: profilePath,
    listings: listings.map((listing) => {
      const tracker = trackerById.get(listing.id);
      const evaluation = evaluationById.get(listing.id);
      return {
        id: listing.id,
        title: listing.property.title,
        source_url: listing.source.url,
        tracker: tracker ? { state: tracker.state, availability: tracker.availability } : null,
        property: {
          operation: listing.property.operation,
          property_type: listing.property.property_type,
          location: {
            city: listing.property.location.city,
            neighborhood: listing.property.location.neighborhood
          },
          pricing: { ...listing.property.pricing },
          features: {
            bedrooms: listing.property.features.bedrooms,
            bathrooms: listing.property.features.bathrooms,
            area_total_m2: listing.property.features.area_total_m2,
            parking_spaces: listing.property.features.parking_spaces
          }
        },
        provenance: { ...listing.provenance },
        evaluation: {
          eligibility: evaluation.eligibility,
          score_percentage: evaluation.score.percentage,
          maximum_possible_percentage: evaluation.score.maximum_possible_percentage,
          coverage_percentage: evaluation.score.coverage_percentage,
          recommendation: evaluation.recommendation,
          trade_offs: evaluation.trade_offs,
          missing_data: evaluation.missing_data,
          red_flags: evaluation.red_flags
        },
        duplicate: { group_id: listing.duplicate.group_id, confidence: listing.duplicate.confidence }
      };
    })
  };
}
