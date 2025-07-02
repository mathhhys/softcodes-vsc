We are a fork of Roo. We regularly merge in the Roo codebase. To enable us to merge more easily we mark all
our own changes with kilocode_change

Either on the same line:

let i = 2; // kilocode_change

or before and after when there are multiple lines:

// kilocode_change start
let i = 2;
let j = 3;
// kilocode_change end

Please make sure in PRs that aren't Roo merges these are added
