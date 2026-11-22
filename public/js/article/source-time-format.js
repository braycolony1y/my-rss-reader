// Forum post timestamps use the reader's local time zone. Reuse formatters
// across all posts; the Vietnam-time card formatter is a separate contract.
const ReaderSourceTimeFormat = {
    time: new Intl.DateTimeFormat('en-US', {hour:'numeric', minute:'2-digit'}),
    weekday: new Intl.DateTimeFormat('en-US', {weekday:'long'}),
    date: new Intl.DateTimeFormat('en-US', {year:'numeric', month:'short', day:'numeric'}),
    exact: new Intl.DateTimeFormat('en-US', {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})
};
