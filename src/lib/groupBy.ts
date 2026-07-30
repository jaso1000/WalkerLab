// A section-list group, matching the shape `SectionList` expects.
export interface Section<T> {
  title: string;
  data: T[];
}

// Groups an already-sorted list into `Section`s by consecutive matching
// labels (e.g. day headers on an Upcoming list). Intentionally does NOT
// re-sort or bucket by label globally - if the same label appears twice with
// a different label in between, it becomes two separate sections. Callers
// are expected to sort `items` first so labels naturally come out grouped.
export function groupConsecutive<T>(items: T[], labelFor: (item: T) => string): Section<T>[] {
  const sections: Section<T>[] = [];
  for (const item of items) {
    const label = labelFor(item);
    const last = sections[sections.length - 1];
    if (last && last.title === label) {
      last.data.push(item);
    } else {
      sections.push({ title: label, data: [item] });
    }
  }
  return sections;
}
