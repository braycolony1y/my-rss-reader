
class SourceRegistry {
    constructor() {
        this.sources = [];
    }

    register(source) {
        this.sources.push(source);
    }

    getHandler(url) {
        if (!url) return null;
        let hostname;
        try {
            hostname = new URL(url).hostname.toLowerCase();
        } catch (e) {
            return null;
        }
        return this.sources.find(s => s.match(hostname)) || null;
    }
}

const registry = new SourceRegistry();

// Register specific sources
import VozSource from './VozSource.js';
import VietnamplusSource from './VietnamplusSource.js';
import TinhteSource from './TinhteSource.js';
import TheVergeSource from './TheVergeSource.js';
import FinancialTimesSource from './FinancialTimesSource.js';
import VietnamnetSource from './VietnamnetSource.js';
import TienPhongSource from './TienPhongSource.js';
import VovSource from './VovSource.js';
import Kenh14Source from './Kenh14Source.js';
import BaotintucSource from './BaotintucSource.js';
import SohaSource from './SohaSource.js';
import ZnewsSource from './ZnewsSource.js';
import TuoitreSource from './TuoitreSource.js';
import SimpleIconSource from './SimpleIconSource.js';
import NhanDanSource from './NhanDanSource.js';
import ThanhNienSource from './ThanhNienSource.js';
import VnexpressSource from './VnexpressSource.js';
import VtvSource from './VtvSource.js';
import DantriSource from './DantriSource.js';
import CafeFSource from './CafeFSource.js';
import ApnewsSource from './ApnewsSource.js';
import NytSource from './NytSource.js';
import UpgradedPointsSource from './UpgradedPointsSource.js';
import BBCSource from './BBCSource.js';
import SggpSource from './SggpSource.js';
import DanvietSource from './DanvietSource.js';
import BaovanhoaSource from './BaovanhoaSource.js';
import TechmemeSource from './TechmemeSource.js';
import CnbcSource from './CnbcSource.js';
import BloombergSource from './BloombergSource.js';
import TheHillSource from './TheHillSource.js';
registry.register(new VozSource());
registry.register(new TinhteSource());
registry.register(new VietnamplusSource());
registry.register(new TheVergeSource());
registry.register(new FinancialTimesSource());
registry.register(new VietnamnetSource());
registry.register(new TienPhongSource());
registry.register(new VovSource());
registry.register(new Kenh14Source());
registry.register(new BaotintucSource());
registry.register(new SohaSource());
registry.register(new ZnewsSource());
registry.register(new TuoitreSource());
registry.register(new SimpleIconSource());
registry.register(new NhanDanSource());
registry.register(new ThanhNienSource());
registry.register(new VnexpressSource());
registry.register(new VtvSource());
registry.register(new DantriSource());
registry.register(new CafeFSource());
registry.register(new ApnewsSource());
registry.register(new NytSource());
registry.register(new UpgradedPointsSource());
registry.register(new BBCSource());
registry.register(new SggpSource());
registry.register(new DanvietSource());
registry.register(new BaovanhoaSource());
registry.register(new BloombergSource());
registry.register(new TheHillSource());
registry.register(new TechmemeSource());
registry.register(new CnbcSource());

export default registry;
