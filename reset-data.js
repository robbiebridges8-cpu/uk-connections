require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function resetData() {
    console.log('Starting database reset...\n');

    // 1. Delete all daily_scores
    console.log('Deleting daily_scores...');
    const { error: scoresError, count: scoresCount } = await supabase
        .from('daily_scores')
        .delete()
        .neq('id', 0) // Delete all rows (workaround for delete all)
        .select('*', { count: 'exact', head: true });

    // Alternative: delete where a column is not null
    const { error: scoresError2 } = await supabase
        .from('daily_scores')
        .delete()
        .not('player_uuid', 'is', null);

    if (scoresError2) {
        console.error('Error deleting daily_scores:', scoresError2.message);
    } else {
        const { count } = await supabase.from('daily_scores').select('*', { count: 'exact', head: true });
        console.log(`  daily_scores: ${count || 0} rows remaining`);
    }

    // 2. Delete all league_memberships
    console.log('Deleting league_memberships...');
    const { error: membersError } = await supabase
        .from('league_memberships')
        .delete()
        .not('player_uuid', 'is', null);

    if (membersError) {
        console.error('Error deleting league_memberships:', membersError.message);
    } else {
        const { count } = await supabase.from('league_memberships').select('*', { count: 'exact', head: true });
        console.log(`  league_memberships: ${count || 0} rows remaining`);
    }

    // 3. Delete all leagues
    console.log('Deleting leagues...');
    const { error: leaguesError } = await supabase
        .from('leagues')
        .delete()
        .not('id', 'is', null);

    if (leaguesError) {
        console.error('Error deleting leagues:', leaguesError.message);
    } else {
        const { count } = await supabase.from('leagues').select('*', { count: 'exact', head: true });
        console.log(`  leagues: ${count || 0} rows remaining`);
    }

    // 4. Delete all players
    console.log('Deleting players...');
    const { error: playersError } = await supabase
        .from('players')
        .delete()
        .not('uuid', 'is', null);

    if (playersError) {
        console.error('Error deleting players:', playersError.message);
    } else {
        const { count } = await supabase.from('players').select('*', { count: 'exact', head: true });
        console.log(`  players: ${count || 0} rows remaining`);
    }

    console.log('\n--- Final verification ---');

    const { count: finalPlayers } = await supabase.from('players').select('*', { count: 'exact', head: true });
    const { count: finalLeagues } = await supabase.from('leagues').select('*', { count: 'exact', head: true });
    const { count: finalScores } = await supabase.from('daily_scores').select('*', { count: 'exact', head: true });
    const { count: finalMembers } = await supabase.from('league_memberships').select('*', { count: 'exact', head: true });
    const { count: puzzles } = await supabase.from('puzzles').select('*', { count: 'exact', head: true });

    console.log(`players: ${finalPlayers || 0}`);
    console.log(`leagues: ${finalLeagues || 0}`);
    console.log(`daily_scores: ${finalScores || 0}`);
    console.log(`league_memberships: ${finalMembers || 0}`);
    console.log(`puzzles: ${puzzles || 0} (not deleted)`);

    console.log('\nDatabase reset complete!');
    console.log('\nREMINDER: Manually delete all users from Supabase Dashboard -> Authentication -> Users');
}

resetData().catch(console.error);
